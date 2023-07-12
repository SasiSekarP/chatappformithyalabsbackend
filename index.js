const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const { MongoClient } = require("mongodb");
const url = "mongodb://127.0.0.1:27017";
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "http://localhost:3000",
  },
});

const cors = require("cors");
const { Socket } = require("dgram");
app.use(cors());
app.use(express.json());
const secretKey = "MY_SECRET_TOKEN";

// Track connected users
const users = {};

async function connectToMongoDB() {
  try {
    const client = await MongoClient.connect(url);
    console.log("Connected to the MongoDB server");

    const db = client.db("chatapp");
    const chatUserDetails = db.collection("chatUserDetails");
    const contactChatCollection = db.collection("contactChatCollection");
    const groupchat = db.collection("groupchat");
    const groupmanagementcollection = db.collection(
      "groupmanagementcollection"
    );

    io.on("connection", (socket) => {
      //login
      socket.on("login", async (data) => {
        const { username, password } = data;
        const userExist = await chatUserDetails.findOne({ username: username });
        if (userExist) {
          const passwordcheckBoolean = await bcrypt.compare(
            password,
            userExist.hashedPassword
          );
          if (passwordcheckBoolean) {
            const payload = {
              username: username,
            };
            const jwtToken = jwt.sign(payload, secretKey);
            socket.emit("loginmessage", {
              loginStatus: "ok",
              message: "login successfull",
              token: jwtToken,
              expire: 1,
              username,
            });
          } else {
            socket.emit("loginmessage", {
              loginStatus: "fail",
              message: "Username and password does not match",
            });
          }
        } else {
          socket.emit("loginmessage", {
            loginStatus: "fail",
            message: `there is no user in this name. Sign up please`,
          });
        }
      });

      // sign up
      socket.on("signup", async (data) => {
        const { username, password } = data;
        const user = await chatUserDetails.findOne({ username: username });
        if (user) {
          socket.emit("signupmessage", {
            status: "fail",
            message: "User already exists",
          });
        } else {
          const hashedPassword = await bcrypt.hash(password, 10);
          chatUserDetails.insertOne({
            username,
            hashedPassword,
          });
          groupmanagementcollection.insertOne({
            username,
            groupnamearr: [],
            admingrouparr: [],
          });
          socket.emit("signupmessage", {
            status: "ok",
            message: "Account is created successfully. You can login now",
          });
        }
      });

      // fetch contact
      socket.on("fetchContact", (data) => {
        const { token } = data;
        jwt.verify(token, secretKey, async (err, payload) => {
          if (err) {
            console.log(err);
          } else {
            const { username } = payload;
            const contacts = await chatUserDetails
              .find({}, { _id: 0, username: 1 })
              .sort({ username: 1 })
              .toArray();

            const contactArr = contacts.map((data) => {
              return { username: data.username, id: data._id.toString() };
            });

            const contactArrWithoutUser = contactArr.filter((data) => {
              return data.username !== username;
            });
            socket.emit("sendContacts", contactArrWithoutUser);
          }
        });
      });

      // single person chat
      socket.on("sendSinglePersonChat", async (data) => {
        const { sender, receiver } = data;
        const messageCollection = await contactChatCollection.findOne({
          username: { $all: [sender, receiver] },
        });
        if (!messageCollection) {
          contactChatCollection.insertOne({
            username: [sender, receiver],
            message: [],
          });
        } else {
          socket.emit("backendsendingpersonalchat", messageCollection.message);
        }
      });

      // front-end sending contact message
      socket.on("frontendsendingcontactmessage", async (data) => {
        const { sender, receiver } = data;
        const doesChatExist = await contactChatCollection.findOne({
          username: { $all: [sender, receiver] },
        });

        if (!doesChatExist) {
          contactChatCollection.insertOne({
            username: { $all: [sender, receiver] },
            message: [],
          });
        }

        contactChatCollection.updateOne(
          {
            username: { $all: [sender, receiver] },
          },
          { $push: { message: { $each: [data] } } }
        );

        const messageCollection = await contactChatCollection.findOne({
          username: { $all: [sender, receiver] },
        });
        socket.emit("messageUpdated", messageCollection.message);

        // io.to(people[receiver]).emit(
        // "messageUpdated",
        // messageCollection.message
        // );
        // io.to(people[sender]).emit(
        //   "messageUpdateds",
        //   messageCollection.message
        // );
      });

      // create new group
      socket.on("createnewgroup", (data) => {
        console.log(data);
        const { selectedValues, groupname, groupid } = data;
        groupchat.insertOne({
          members: selectedValues,
          groupname,
          _id: groupid,
          admin: [],
          message: [],
        });

        selectedValues.map(async (data) => {
          const user = await groupmanagementcollection.findOne({
            username: data,
          });
          if (!user) {
            groupmanagementcollection.insertOne({
              username: data,
              groupnamearr: { groupid },
            });
          }
          groupmanagementcollection.updateOne(
            { username: data },
            {
              $push: {
                groupnamearr: { groupid: groupid, groupname: groupname },
              },
            }
          );
        });

        console.log("hit");

        socket.emit("creategroupstatus", { status: "ok" });
      });

      // add admin get member list
      socket.on("sendmemberlist", async (data) => {
        // console.log(data);
        const membersfile = await groupchat.findOne({ _id: data });
        console.log(membersfile);
        // const memberarr = await membersfile.members;
        // socket.emit("backendsendingmemberlisttomakeadmin", memberarr);
      });

      // add new admin
      socket.on("addadmin", (data) => {
        groupchat.updateOne(
          { _id: data.groupid },
          { $push: { admin: { $each: data.admin } } }
        );

        data.admin.map((data1) => {
          groupmanagementcollection.updateOne(
            { username: data1 },
            {
              $push: {
                admingrouparr: {
                  groupid: data.groupid,
                  groupname: data.groupname,
                },
              },
            }
          );
        });
      });

      // sending group list to single person
      socket.on("grouplistfetch", async (data) => {
        const groupdetails = await groupmanagementcollection.findOne({
          username: data,
        });
        const grouparr = await groupdetails.groupnamearr;
        socket.emit("grouplistresponse", grouparr);
      });

      // sendgroupchat
      socket.on("sendgroupchat", async (data) => {
        const chatdata = await groupchat.findOne({ _id: data });
        socket.emit("groupchat", chatdata);
      });

      // messagefromgroupchat
      socket.on("messagefromgroupchat", async (data) => {
        groupchat.updateOne(
          { _id: data.groupid },
          { $push: { message: data } }
        );

        const chatdata = await groupchat.findOne({ _id: data });

        socket.emit("updatedgroupmessage", chatdata);
      });

      // sending data for Remove admin
      socket.on("sendadmindetails", async (data) => {
        const groupdetails = await groupchat.findOne({ _id: data });
        const adminarr = await groupdetails.admin;
        socket.emit("adminarrforeditingfrombackend", adminarr);
      });

      // remove these members from admin post
      socket.on("removethesemembersfromadminpost", (data) => {
        groupchat.updateOne(
          { _id: data.groupid },
          { $pull: { admin: { $in: data.arr } } }
        );
        data.arr.map((singledata) => {
          groupmanagementcollection.updateOne(
            { username: singledata },
            {
              $pull: { admingrouparr: { groupid: data.groupid } },
            }
          );
        });
      });

      // sending list of available people to beadmin
      socket.on("sendlistofavailablepeopletobeadmin", async (data) => {
        const groupdata = await groupchat.findOne({ _id: data });
        const availablemembers = groupdata.members.filter(
          (element) => !groupdata.admin.includes(element)
        );
        socket.emit("responseforavaliablepeopletobeadmin", availablemembers);
      });

      // Handle disconnection
      socket.on("disconnect", () => {
        // Remove the user from the list of connected users
        for (const username in users) {
          if (users[username] === socket) {
            delete users[username];
            break;
          }
        }
      });
    });

    server.listen(4000, () => {
      console.log("Server is running on http://localhost:4000");
    });
  } catch (error) {
    console.error("Error connecting to the MongoDB server:", error);
  }
}

connectToMongoDB();
