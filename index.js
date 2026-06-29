import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { ObjectId } from "mongodb";



import { verifyToken } from "./middleware/auth.js";
import { collectionName, connection } from "./dbconfig.js";


import { v2 as cloudinary } from "cloudinary";
import multer from "multer";

import dotenv from "dotenv";
dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET
});


const app = express();
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
app.use(cors({
  origin: frontendUrl,
  credentials: true
}));

app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || "7874317332";

/* ================= SERVER + SOCKET SETUP ================= */

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: frontendUrl,
    methods: ["GET", "POST"],
    credentials: true
  }
});




/* ================= AUTH ROUTES ================= */

app.post("/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        msg: "All fields are required"
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const db = await connection();
    const collection = db.collection(collectionName);

   const mailexist = await collection.findOne({email})

   if(mailexist)
   {
      return res.status(400).json({
  success: false,
  msg: "User with this email already exist"
    });
   }
   
    const result = await collection.insertOne({
      name,
      email,
      password: hashedPassword,
      access:"disallow",
    });

    const token = jwt.sign(
      { id: result.insertedId.toString(), email, name },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.status(201).json({
      success: true,
      msg: "Signup successful",
      token,
      user: {
        id: result.insertedId,
        name,
        email
      }
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/contact", async (req,resp)=>
{
   try {
  const db = await connection();
  const collection = db.collection("contact-form");
  const {name,email,address,phone,comment}=req.body;

  await collection.insertOne({
     name,
     email,
     address,
     phone,
     comment
  });
  resp.json({
    success: true,
    msg: "Contact Added successful"
  });
    }
      catch (err) {
      console.error(err);
      resp.status(500).json({ success: false, error: err.message });
    }
  
  });

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const db = await connection();
    const collection = db.collection(collectionName);

    const user = await collection.findOne({ email });

    if (!user) {
      return res.status(401).json({
        success: false,
        msg: "User not found"
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        msg: "Invalid password"
      });
    }

    const token = jwt.sign(
      { id: user._id.toString(), email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

/* ================= USER LIST ================= */

app.get("/userlist", verifyToken, async (req, res) => {
  const db = await connection();
  const collection = db.collection(collectionName);
  const messages = db.collection("messages");

  const users = await collection.find(
    { _id: { $ne: new ObjectId(req.user.id) } },
    { projection: { password: 0 } }
  ).toArray();

  const unreadCounts = await messages.aggregate([
    { $match: { receiverId: req.user.id, isSeen: false } },
    { $group: { _id: "$senderId", count: { $sum: 1 } } }
  ]).toArray();

  const countMap = unreadCounts.reduce((acc, item) => {
    acc[item._id] = item.count;
    return acc;
  }, {});

  const usersWithUnread = users.map(user => ({
    ...user,
    unreadCount: countMap[user._id] || 0,
  }));

  res.json(usersWithUnread);
});

/* ================= GET MESSAGES ================= */

app.get("/messages/:id", verifyToken, async (req, res) => {
  const db = await connection();
  const messages = db.collection("messages");

  const chat = await messages.find({
    $or: [
      { senderId: req.user.id, receiverId: req.params.id },
      { senderId: req.params.id, receiverId: req.user.id }
    ]
  }).sort({ createdAt: 1 }).toArray();

  res.json(chat);
});

app.delete("/message/:id", verifyToken, async (req, res) => {
  const db = await connection();
  const messages = db.collection("messages");
  const messageId = req.params.id;

  let message = null;

  if (ObjectId.isValid(messageId)) {
    message = await messages.findOne({ _id: new ObjectId(messageId) });
  }

  if (!message) {
    message = await messages.findOne({ clientMessageId: messageId });
  }

  if (!message) {
    return res.status(404).json({ msg: "Message not found" });
  }

  if (message.senderId !== req.user.id) {
    return res.status(403).json({ msg: "Not allowed" });
  }

  await messages.deleteOne({ _id: message._id });

  res.json({ success: true, deletedMessageId: messageId });
});

const upload = multer({ storage: multer.memoryStorage() });
app.post("/upload", verifyToken, upload.single("file"), async (req, res) => {
  try {
    const result = await cloudinary.uploader.upload_stream(
      {
        resource_type: "auto"
      },
      async (error, result) => {
        if (error) return res.status(500).json({ error });

        res.json({
          url: result.secure_url,
          type: result.resource_type
        });
      }
    );

    result.end(req.file.buffer);

  } catch (err) {
    res.status(500).json({ msg: "Upload failed" });
  }
});

app.get("/unread-count", verifyToken, async (req, res) => {
  const db = await connection();
  const messages = db.collection("messages");

  const count = await messages.countDocuments({
    receiverId: req.user.id,
    isSeen: false
  });

  res.json({ count });
});

app.put("/mark-seen/:senderId", verifyToken, async (req, res) => {
  try {
    const db = await connection();
    const messages = db.collection("messages");

    const senderId = req.params.senderId;

    await messages.updateMany(
      {
        senderId: senderId,
        receiverId: req.user.id,
        isSeen: false
      },
      { $set: { isSeen: true } }
    );

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ msg: "Error marking as seen" });
  }
});




/* ================= SOCKET.IO ================= */
/* ================= SOCKET.IO ================= */
let onlineUsers = {};

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  /* ================= JOIN ================= */
  socket.on("join", (userId) => {
    onlineUsers[userId] = socket.id;
  });

  /* ================= CALL USER ================= */
  socket.on("callUser", ({ to, from, signal, name, type }) => {
    console.log("callUser received:", { to, from, name, type: type });
    const receiverSocket = onlineUsers[to];

    if (receiverSocket) {
      console.log("Forwarding incomingCall to receiver with name:", name);
      io.to(receiverSocket).emit("incomingCall", {
        from,
        signal,
        name,
        type,
      });
    } else {
      console.log("Receiver socket not found for user:", to);
    }
  });

  /* ================= ACCEPT CALL ================= */
  socket.on("acceptCall", ({ to, signal }) => {
    const receiverSocket = onlineUsers[to];

    if (receiverSocket) {
      io.to(receiverSocket).emit("callAccepted", signal);
    }
  });

  /* ================= END CALL ================= */
  socket.on("endCall", ({ to }) => {
    const receiverSocket = onlineUsers[to];

    if (receiverSocket) {
      io.to(receiverSocket).emit("callEnded");
    }
  });

  /* ================= MESSAGE ================= */
  socket.on("sendMessage", async (data, callback) => {
    const { senderId, receiverId, text, mediaUrl, mediaType, replyTo, clientMessageId } = data;

    const db = await connection();
    const messages = db.collection("messages");

    const newMessage = {
      senderId,
      receiverId,
      text: text || null,
      mediaUrl: mediaUrl || null,
      mediaType: mediaType || null,
      replyTo: replyTo || null,
      clientMessageId: clientMessageId || null,
      deletedFor: [],
      isSeen: false,
      createdAt: new Date(),
    };

    const inserted = await messages.insertOne(newMessage);
    const savedMessage = {
      ...newMessage,
      _id: inserted.insertedId,
      clientMessageId: clientMessageId || inserted.insertedId.toString(),
    };

    const receiverSocket = onlineUsers[receiverId];

    if (receiverSocket) {
      io.to(receiverSocket).emit("receiveMessage", savedMessage);
    }

    if (typeof callback === "function") {
      callback(savedMessage);
    }
  });

  /* ================= DISCONNECT ================= */
  socket.on("disconnect", () => {
    for (let userId in onlineUsers) {
      if (onlineUsers[userId] === socket.id) {
        delete onlineUsers[userId];
      }
    }
  });
});

/* ================= IMPORTANT FIX ================= */

server.listen(5000, () => {
  console.log("Server running on port 5000");
});
