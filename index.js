import dotenv from "dotenv";
dotenv.config();
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import jwt from "jsonwebtoken";
import { User } from "./models/User.js";
import cookieParser from "cookie-parser";
import userRouter from "./routes/userRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";
import recentSearchRoutes from "./routes/recentSearchRoutes.js";
import searchRoutes from "./routes/searchRoutes.js";
import { errorMiddleware } from "./middlewares/error.js";
import { connection } from "./database/db.js";

const app = express();
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  cors({
    origin: ["http://localhost:3000", "https://togethertime.netlify.app"],
    credentials: true,
  })
);

app.use("/api/v1/user", userRouter);
app.use("/api/v1/messages", messageRoutes);
app.use("/api/v1/recent-searches", recentSearchRoutes);
app.use("/api/v1/search", searchRoutes);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", rooms: Object.keys(rooms).length });
});

// Connect to MongoDB
connection();

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:3000",
      "http://localhost:3001",
      "https://togethertime.netlify.app",
    ],
    methods: ["GET", "POST"],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

/* ---------------- ROOM STORE ---------------- */

const rooms = {};
const typingUsers = {};

const getRoom = (roomId) => rooms[roomId] || null;

const findUserByClientId = (room, clientId) => {
  return room.users.find((u) => u.clientId === clientId);
};

const broadcastRoomState = (roomId) => {
  const room = getRoom(roomId);
  if (room) {
    io.to(roomId).emit("room-state-update", {
      users: room.users.filter((u) => !u.isDisconnected),
      isLocked: room.isLocked,
      host: room.host,
      hostClientId: room.hostClientId,
    });
  }
};

io.use(async (socket, next) => {
  try {
    const cookieHeader = socket.handshake.headers.cookie;
    if (!cookieHeader) return next(new Error("Not authenticated"));

    const cookies = {};
    cookieHeader.split(";").forEach((cookie) => {
      const [name, ...rest] = cookie.trim().split("=");
      cookies[name] = rest.join("=");
    });

    const token = cookies.token;
    if (!token) return next(new Error("Not authenticated"));

    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
    const user = await User.findById(decoded.id);

    if (!user || !user.accountVerified) {
      return next(new Error("Unauthorized"));
    }

    socket.user = user; // 🔥 MAIN LINE
    next();
  } catch (err) {
    next(new Error("Authentication failed"));
  }
});

/* ---------------- SOCKET LOGIC ---------------- */

io.on("connection", (socket) => {
  const clientId = socket.handshake.auth.clientId;
  console.log(
    "🟢 User connected:",
    socket.user.name,
    socket.user._id.toString()
  );

  let currentRoomId = null;

  socket.on("join-room", (roomId, userData) => {
    console.log(`📥 Join room request:`, {
      roomId,
      userData,
      socketId: socket.id,
    });

    if (currentRoomId && currentRoomId !== roomId) {
      socket.leave(currentRoomId);
    }

    socket.join(roomId);
    currentRoomId = roomId;

    const userClientId = userData?.clientId || clientId;

    // Create room if not exists
    if (!rooms[roomId]) {
      const isHostIntent = userData?.isHost === true;

      if (!isHostIntent) {
        console.log(`❌ Room not found: ${roomId}`);
        socket.emit("room-not-found", {
          message: "This room does not exist.",
          roomId: roomId,
        });
        socket.leave(roomId);
        currentRoomId = null;
        return;
      }
      console.log(`🆕 Creating new room: ${roomId}`);
      rooms[roomId] = {
        host: socket.id,
        hostClientId: userClientId,
        users: [],
        videoId: null,
        platform: null,
        currentTime: 0,
        isPlaying: false,
        isLocked: false,
        lastSyncTime: Date.now(),
        lastActionAt: 0,
        playbackRate: 1,
        videoQuality: "auto",
        bgColor: "#121212",
        bgOpacity: 80,
        selectedBackground: null,
        customBackground: null,
        chatColor: "#6C63FF",
        chatAnimation: "fade",
        fontSize: "medium",
        notifyOnJoin: true,
        notifyOnMessage: true,
        notifyOnVideoControl: true,
        roomName: "",
        roomPrivacy: "public",
        maxParticipants: "unlimited",
        saveRoom: false,
        // Participant Controls
        requireApproval: false,

        // Room Controls
        isRoomClosed: false,
        isRoomLocked: false,
        roomPassword: "",

        // Permission Controls
        allowGuestsToChat: true,
        allowGuestsToChangeVideo: true,
        allowGuestsToControlPlayback: true,
        allowGuestsToChangeSettings: false,
        allowGuestsToShareScreen: true,
        allowGuestsToUseCamera: true,
        allowGuestsToUseMic: true,

        // Moderation Controls
        slowModeEnabled: false,
        slowModeInterval: 5,
        wordFilterEnabled: false,
        blockedWords: [],
        linksFilterEnabled: false,
        emojisOnlyMode: false,

        // Activity Log
        activityLog: [],
        pendingUsers: [],
        bannedUsers: [],
        allMuted: false,
        messages: [],
      };
    }

    const room = rooms[roomId];

    // Check if user is reconnecting
    const existingUser = findUserByClientId(room, userClientId);
    const wasHost = room.hostClientId === userClientId;

    console.log(`🔍 User check:`, {
      existingUser: !!existingUser,
      wasHost,
      hostClientId: room.hostClientId,
      userClientId,
    });

    if (existingUser) {
      // RECONNECTING USER
      console.log(
        `🔄 User reconnecting: ${userData?.name || existingUser.name}`
      );

      existingUser.id = socket.id;
      existingUser.name = userData?.name || existingUser.name;
      existingUser.isMuted = userData?.isMuted ?? existingUser.isMuted;
      existingUser.isDisconnected = false;
      existingUser.disconnectedAt = null;

      if (wasHost) {
        room.host = socket.id;
        existingUser.isHost = true;
        console.log(`👑 Host restored: ${existingUser.name}`);
      }

      socket.emit("room-state", {
        messages: room.messages || [],
        // Video state
        videoId: room.videoId,
        platform: room.platform,
        currentTime: room.currentTime,
        isPlaying: room.isPlaying,
        isLocked: room.isLocked,
        playbackRate: room.playbackRate,
        videoQuality: room.videoQuality,

        // Appearance settings
        bgColor: room.bgColor,
        bgOpacity: room.bgOpacity,
        selectedBackground: room.selectedBackground,
        customBackground: room.customBackground,

        // Personal/Chat settings
        chatColor: room.chatColor,
        chatAnimation: room.chatAnimation,
        fontSize: room.fontSize,

        // Notification settings
        notifyOnJoin: room.notifyOnJoin,
        notifyOnMessage: room.notifyOnMessage,
        notifyOnVideoControl: room.notifyOnVideoControl,

        // Room settings
        roomName: room.roomName,
        roomPrivacy: room.roomPrivacy,
        maxParticipants: room.maxParticipants,
        saveRoom: room.saveRoom,

        // Users and host info
        users: room.users.filter((u) => !u.isDisconnected),
        host: room.host,
        hostClientId: room.hostClientId,
        userId: socket.id,
        isHost: wasHost,

        // Host Controls
        requireApproval: room.requireApproval,
        isRoomLocked: room.isRoomLocked,
        roomPassword: room.roomPassword,
        allowGuestsToChat: room.allowGuestsToChat,
        allowGuestsToShareScreen: room.allowGuestsToShareScreen,
        allowGuestsToUseCamera: room.allowGuestsToUseCamera,
        allowGuestsToUseMic: room.allowGuestsToUseMic,
        slowModeEnabled: room.slowModeEnabled,
        slowModeInterval: room.slowModeInterval,
        wordFilterEnabled: room.wordFilterEnabled,
        blockedWords: room.blockedWords,
        linksFilterEnabled: room.linksFilterEnabled,
        emojisOnlyMode: room.emojisOnlyMode,
        allMuted: room.allMuted,
        pendingUsers: wasHost ? room.pendingUsers : [],
      });

      socket.to(roomId).emit("user-updated", {
        id: socket.id,
        clientId: userClientId,
        name: existingUser.name,
        isHost: wasHost,
        isMuted: existingUser.isMuted,
      });
    } else {
      // NEW USER
      const isFirstUser =
        room.users.filter((u) => !u.isDisconnected).length === 0;

      // Check if user is banned (by clientId OR by name)
      const userName = userData?.name || "";
      const isBanned =
        room.bannedUsers &&
        room.bannedUsers.some(
          (b) =>
            b.clientId === userClientId ||
            (b.name &&
              userName &&
              b.name.toLowerCase() === userName.toLowerCase())
        );
      if (isBanned) {
        console.log(`🚫 Banned user tried to join: ${userClientId}`);
        socket.emit("you-were-banned", {
          message: "You have been banned from this room.",
        });
        socket.leave(roomId);
        currentRoomId = null;
        return;
      }

      // Check if room is locked (not for first user)
      if (!isFirstUser && room.isRoomLocked) {
        console.log(`🔒 Room is locked, rejecting: ${userClientId}`);
        socket.emit("room-locked-error", {
          message: "This room is locked. New users cannot join.",
        });
        socket.leave(roomId);
        currentRoomId = null;
        return;
      }

      // Check room password (not for first user)
      if (!isFirstUser && room.roomPassword && room.roomPassword.length > 0) {
        const providedPassword = userData?.password || "";
        if (providedPassword !== room.roomPassword) {
          console.log(`🔑 Wrong password provided by: ${userClientId}`);
          socket.emit("password-required", {
            message: "This room requires a password.",
            needsPassword: true,
          });
          socket.leave(roomId);
          currentRoomId = null;
          return;
        }
      }

      if (!isFirstUser && room.maxParticipants !== "unlimited") {
        const currentCount = room.users.filter((u) => !u.isDisconnected).length;
        const maxCount = parseInt(room.maxParticipants);

        if (currentCount >= maxCount) {
          console.log(
            `❌ Room ${roomId} is full (${currentCount}/${maxCount})`
          );
          socket.emit("room-full", {
            message: `Room is full. Maximum ${maxCount} participants allowed.`,
            currentCount: currentCount,
            maxCount: maxCount,
          });
          socket.leave(roomId);
          currentRoomId = null;
          return;
        }
      }

      const user = {
        id: socket.id,
        clientId: userClientId,
        name: socket.user.name,
        isHost: isFirstUser,
        isMuted: userData?.isMuted ?? false,
        joinedAt: Date.now(),
        isDisconnected: false,
      };

      // Check if approval is required (not for first user)
      if (!isFirstUser && room.requireApproval) {
        // Add to pending users
        if (!room.pendingUsers) room.pendingUsers = [];
        room.pendingUsers.push(user);

        console.log(`⏳ User waiting for approval: ${user.name}`);

        // Log activity
        if (!room.activityLog) room.activityLog = [];
        room.activityLog.push({
          type: "approval-requested",
          oderId: socket.id,
          userName: user.name,
          timestamp: Date.now(),
        });

        // Tell guest to wait
        socket.emit("waiting-for-approval", {
          message: "Waiting for host to approve your request...",
          userName: user.name,
        });

        // Notify host about join request
        io.to(room.host).emit("join-request", {
          id: socket.id,
          clientId: userClientId,
          name: user.name,
          requestedAt: Date.now(),
        });

        return;
      }

      if (isFirstUser) {
        room.host = socket.id;
        room.hostClientId = userClientId;
        console.log(`👑 First user, setting as host: ${user.name}`);
      }

      room.users.push(user);

      console.log(`✅ New user joined: ${user.name} (host: ${user.isHost})`);

      socket.emit("room-state", {
        messages: room.messages || [],
        // Video state
        videoId: room.videoId,
        platform: room.platform,
        currentTime: room.currentTime,
        isPlaying: room.isPlaying,
        isLocked: room.isLocked,
        playbackRate: room.playbackRate,
        videoQuality: room.videoQuality,

        // Appearance settings
        bgColor: room.bgColor,
        bgOpacity: room.bgOpacity,
        selectedBackground: room.selectedBackground,
        customBackground: room.customBackground,

        // Personal/Chat settings
        chatColor: room.chatColor,
        chatAnimation: room.chatAnimation,
        fontSize: room.fontSize,

        // Notification settings
        notifyOnJoin: room.notifyOnJoin,
        notifyOnMessage: room.notifyOnMessage,
        notifyOnVideoControl: room.notifyOnVideoControl,

        // Room settings
        roomName: room.roomName,
        roomPrivacy: room.roomPrivacy,
        maxParticipants: room.maxParticipants,
        saveRoom: room.saveRoom,

        // Users and host info
        users: room.users.filter((u) => !u.isDisconnected),
        host: room.host,
        hostClientId: room.hostClientId,
        userId: socket.id,
        isHost: user.isHost,

        // Host Controls
        requireApproval: room.requireApproval,
        isRoomLocked: room.isRoomLocked,
        roomPassword: room.roomPassword,
        allowGuestsToChat: room.allowGuestsToChat,
        allowGuestsToShareScreen: room.allowGuestsToShareScreen,
        allowGuestsToUseCamera: room.allowGuestsToUseCamera,
        allowGuestsToUseMic: room.allowGuestsToUseMic,
        slowModeEnabled: room.slowModeEnabled,
        slowModeInterval: room.slowModeInterval,
        wordFilterEnabled: room.wordFilterEnabled,
        blockedWords: room.blockedWords,
        linksFilterEnabled: room.linksFilterEnabled,
        emojisOnlyMode: room.emojisOnlyMode,
        allMuted: room.allMuted,
        pendingUsers: user.isHost ? room.pendingUsers : [],
      });

      socket.to(roomId).emit("user-joined", user);
    }

    console.log(
      `📊 Room ${roomId}: ${
        room.users.filter((u) => !u.isDisconnected).length
      } active users`
    );
  });

  socket.on("video-change", (roomId, data) => {
    const room = getRoom(roomId);
    if (!room) return;

    if (room.host === socket.id || !room.isLocked) {
      room.videoId = data.videoId;
      room.platform = data.platform;
      room.currentTime = 0;
      room.isPlaying = true;
      room.lastSyncTime = Date.now();

      socket.to(roomId).emit("video-change", data);
      console.log(
        `🎬 Room ${roomId}: Video changed to ${data.platform}/${data.videoId}`
      );
    }
  });

  socket.on("playback-intent", (roomId, intent) => {
    const room = rooms[roomId];
    if (!room) return;

    if (room.isLocked && socket.id !== room.host) return;
    if (intent.sentAt < room.lastActionAt) return;

    const isHost = socket.id === room.host;

    let timeToUse;

    if (isHost) {
      // Host can set any time
      timeToUse = intent.time;
    } else if (intent.action === "seek") {
      // ⭐ FIX: For SEEK, accept guest's time (they explicitly want to seek)
      timeToUse = intent.time;
    } else {
      // For play/pause from guest: Use server's current time (prevents lag pullback)
      if (room.isPlaying && room.lastSyncTime) {
        const elapsed = (Date.now() - room.lastSyncTime) / 1000;
        timeToUse = room.currentTime + elapsed;
      } else {
        timeToUse = room.currentTime;
      }
      console.log(
        `⚠️ Guest play/pause: using server time ${timeToUse.toFixed(2)}s`
      );
    }

    room.lastActionAt = intent.sentAt;

    if (intent.action === "play") {
      room.isPlaying = true;
    } else if (intent.action === "pause") {
      room.isPlaying = false;
    }

    room.currentTime = timeToUse;
    room.lastSyncTime = Date.now();

    io.to(roomId).emit("playback-state", {
      playing: room.isPlaying,
      time: room.currentTime,
      senderId: socket.id,
    });

    console.log(
      `🎬 ${intent.action.toUpperCase()} @ ${room.currentTime.toFixed(2)}s by ${
        socket.id
      } (host: ${isHost})`
    );
  });

  socket.on("request-sync", (roomId) => {
    const room = getRoom(roomId);
    if (!room) return;

    let currentTime = room.currentTime;
    if (room.isPlaying && room.lastSyncTime) {
      const elapsed = (Date.now() - room.lastSyncTime) / 1000;
      currentTime = room.currentTime + elapsed;
    }

    socket.emit("playback-state", {
      playing: room.isPlaying,
      time: currentTime,
      senderId: "server",
    });

    console.log(
      `🔄 Sync sent to ${socket.id}: playing=${
        room.isPlaying
      }, time=${currentTime.toFixed(2)}s`
    );
  });

  // User started typing
  socket.on("typing-start", (roomId) => {
    const room = getRoom(roomId);
    if (!room) {
      console.log("❌ Typing: Room not found", roomId);
      return;
    }

    const user = room.users.find((u) => u.id === socket.id);
    if (!user) {
      console.log("❌ Typing: User not found", socket.id);
      return;
    }

    // Initialize typing users for room if not exists
    if (!typingUsers[roomId]) {
      typingUsers[roomId] = {};
    }

    // Add user to typing list
    typingUsers[roomId][socket.id] = {
      id: socket.id,
      name: user.name,
      timestamp: Date.now(),
    };

    const typingList = Object.values(typingUsers[roomId]);

    console.log(
      `⌨️ ${user.name} is typing in room ${roomId}. Typing users:`,
      typingList.map((u) => u.name)
    );

    // Broadcast to ALL users in room (including sender for debugging)
    io.to(roomId).emit("user-typing", {
      oderId: socket.id,
      userName: user.name,
      typingUsers: typingList,
    });
  });

  // User stopped typing
  socket.on("typing-stop", (roomId) => {
    const room = getRoom(roomId);
    if (!room) return;

    const user = room.users.find((u) => u.id === socket.id);

    // Remove user from typing list
    if (typingUsers[roomId] && typingUsers[roomId][socket.id]) {
      delete typingUsers[roomId][socket.id];
    }

    const typingList = typingUsers[roomId]
      ? Object.values(typingUsers[roomId])
      : [];

    console.log(
      `⌨️ ${user?.name || "User"} stopped typing in room ${roomId}. Remaining:`,
      typingList.map((u) => u.name)
    );

    // Broadcast to ALL users in room
    io.to(roomId).emit("user-stopped-typing", {
      oderId: socket.id,
      typingUsers: typingList,
    });
  });

  // Virtual Reactions (Popcorn, Confetti, etc.)
  socket.on("send-reaction", (roomId, reactionType) => {
    const room = getRoom(roomId);
    if (!room) return;

    const user = room.users.find((u) => u.id === socket.id);
    if (!user) return;

    console.log(`🍿 ${user.name} sent ${reactionType} in room ${roomId}`);

    // Broadcast to ALL users in room (including sender)
    io.to(roomId).emit("receive-reaction", {
      oderId: socket.id,
      userName: user.name,
      reactionType: reactionType,
      timestamp: Date.now(),
    });
  });

  // ============================================
  // WebRTC Signaling for Video/Audio Calls
  // ============================================

  // User wants to start/join video call
  socket.on("join-video-call", (roomId) => {
    const room = getRoom(roomId);
    if (!room) return;

    const user = room.users.find((u) => u.id === socket.id);
    if (!user) return;

    // Initialize video call participants if not exists
    if (!room.videoCallParticipants) {
      room.videoCallParticipants = [];
    }

    // Add user to video call if not already in
    if (!room.videoCallParticipants.includes(socket.id)) {
      room.videoCallParticipants.push(socket.id);
    }

    console.log(`📹 ${user.name} joined video call in room ${roomId}`);

    // Notify all other participants that a new user joined
    socket.to(roomId).emit("video-user-joined", {
      oderId: socket.id,
      userName: user.name,
      participants: room.videoCallParticipants,
    });

    // Send current participants list to the joining user
    socket.emit("video-call-participants", {
      participants: room.videoCallParticipants.filter((id) => id !== socket.id),
    });
  });

  // User leaves video call
  socket.on("leave-video-call", (roomId) => {
    const room = getRoom(roomId);
    if (!room) return;

    const user = room.users.find((u) => u.id === socket.id);

    // Remove from video call participants
    if (room.videoCallParticipants) {
      room.videoCallParticipants = room.videoCallParticipants.filter(
        (id) => id !== socket.id
      );
    }

    console.log(`📹 ${user?.name || "User"} left video call in room ${roomId}`);

    // Notify others
    socket.to(roomId).emit("video-user-left", {
      oderId: socket.id,
      userName: user?.name,
    });
  });

  // WebRTC Offer - User A sends offer to User B
  socket.on("webrtc-offer", (roomId, targetUserId, offer) => {
    console.log(`🔗 WebRTC Offer from ${socket.id} to ${targetUserId}`);

    io.to(targetUserId).emit("webrtc-offer", {
      fromUserId: socket.id,
      offer: offer,
    });
  });

  // WebRTC Answer - User B responds to User A's offer
  socket.on("webrtc-answer", (roomId, targetUserId, answer) => {
    console.log(`🔗 WebRTC Answer from ${socket.id} to ${targetUserId}`);

    io.to(targetUserId).emit("webrtc-answer", {
      fromUserId: socket.id,
      answer: answer,
    });
  });

  // ICE Candidate - Exchange network information
  socket.on("webrtc-ice-candidate", (roomId, targetUserId, candidate) => {
    console.log(`🧊 ICE Candidate from ${socket.id} to ${targetUserId}`);

    io.to(targetUserId).emit("webrtc-ice-candidate", {
      fromUserId: socket.id,
      candidate: candidate,
    });
  });

  // Update media state (camera/mic on/off)
  socket.on("media-state-change", (roomId, mediaState) => {
    const room = getRoom(roomId);
    if (!room) return;

    const user = room.users.find((u) => u.id === socket.id);
    if (!user) return;

    // Update user's media state
    user.isCameraMuted = mediaState.isCameraMuted;
    user.isMicMuted = mediaState.isMicMuted;

    console.log(
      `📹🎤 ${
        user.name
      } media state: camera=${!mediaState.isCameraMuted}, mic=${!mediaState.isMicMuted}`
    );

    // Broadcast to all users in room
    io.to(roomId).emit("user-media-state-changed", {
      oderId: socket.id,
      userName: user.name,
      isCameraMuted: mediaState.isCameraMuted,
      isMicMuted: mediaState.isMicMuted,
    });
  });

  socket.on("send-message", (roomId, message) => {
    const room = getRoom(roomId);
    if (!room) return;

    const user = room.users.find((u) => u.id === socket.id);
    const isHost = socket.id === room.host;

    // Check if chat is disabled for guests
    if (!isHost && !room.allowGuestsToChat) {
      socket.emit("error-message", { message: "Chat is disabled by host" });
      return;
    }

    // Check slow mode
    if (!isHost && room.slowModeEnabled) {
      const lastMessageTime = user?.lastMessageTime || 0;
      const timeSinceLastMessage = Date.now() - lastMessageTime;
      const requiredInterval = room.slowModeInterval * 1000;

      if (timeSinceLastMessage < requiredInterval) {
        const waitTime = Math.ceil(
          (requiredInterval - timeSinceLastMessage) / 1000
        );
        socket.emit("error-message", {
          message: `Slow mode: Please wait ${waitTime} seconds before sending another message`,
        });
        return;
      }
    }

    let messageText = message.text;

    // Check emojis only mode
    if (room.emojisOnlyMode && !isHost) {
      const emojiRegex = /^[\p{Emoji}\s]+$/u;
      if (!emojiRegex.test(messageText)) {
        socket.emit("error-message", {
          message: "Only emojis are allowed in chat",
        });
        return;
      }
    }

    // Check links filter
    if (room.linksFilterEnabled && !isHost) {
      const urlRegex = /(https?:\/\/[^\s]+)/gi;
      if (urlRegex.test(messageText)) {
        socket.emit("error-message", {
          message: "Links are not allowed in chat",
        });
        return;
      }
    }

    // Apply word filter
    if (room.wordFilterEnabled && room.blockedWords.length > 0 && !isHost) {
      room.blockedWords.forEach((word) => {
        const regex = new RegExp(word, "gi");
        messageText = messageText.replace(regex, "***");
      });
    }

    // Update last message time for slow mode
    if (user) {
      user.lastMessageTime = Date.now();
    }

    const enrichedMessage = {
      ...message,
      text: messageText,
      id: `${socket.id}-${Date.now()}`,
      oderId: socket.id,
      userName: user?.name || message.user || "Unknown",
      timestamp: Date.now(),
    };

    // STORE MESSAGE IN ROOM (no limit)
    if (!room.messages) room.messages = [];
    room.messages.push(enrichedMessage);

    io.to(roomId).emit("receive-message", enrichedMessage);
    console.log(
      `💬 Room ${roomId}: ${enrichedMessage.userName}: ${messageText}`
    );
  });

  socket.on("toggle-lock", (roomId, isLocked) => {
    const room = getRoom(roomId);
    if (room && room.host === socket.id) {
      room.isLocked = isLocked;
      io.to(roomId).emit("room-locked", isLocked);
      console.log(`🔒 Room ${roomId}: ${isLocked ? "Locked" : "Unlocked"}`);
    }
  });

  socket.on("playback-rate-change", (roomId, data) => {
    const room = getRoom(roomId);
    if (!room) return;

    // Check if room is locked and user is not host
    if (room.isLocked && socket.id !== room.host) {
      console.log("🔒 Rate change blocked - room is locked");
      return;
    }

    // Store rate in room (optional, for new joiners)
    room.playbackRate = data.rate;

    // Broadcast to all in room
    io.to(roomId).emit("playback-rate-change", {
      rate: data.rate,
      senderId: socket.id,
    });

    console.log(
      `⚡ Room ${roomId}: Speed changed to ${data.rate}x by ${socket.id}`
    );
  });

  socket.on("quality-change", (roomId, data) => {
    const room = getRoom(roomId);
    if (!room) return;

    // Check if room is locked and user is not host
    if (room.isLocked && socket.id !== room.host) {
      console.log("🔒 Quality change blocked - room is locked");
      return;
    }

    // Store quality in room
    room.videoQuality = data.quality;

    // Broadcast to all in room
    io.to(roomId).emit("quality-change", {
      quality: data.quality,
      senderId: socket.id,
    });

    console.log(
      `🎥 Room ${roomId}: Quality changed to ${data.quality} by ${socket.id}`
    );
  });

  socket.on("appearance-change", (roomId, data) => {
    const room = getRoom(roomId);
    if (!room) return;

    console.log("🎨 Appearance data received:", data);

    // Get user name for logging
    const user = room.users.find((u) => u.id === socket.id);
    const userName = user?.name || "Unknown";

    // Update room appearance settings
    if (data.bgColor !== undefined) room.bgColor = data.bgColor;
    if (data.bgOpacity !== undefined) room.bgOpacity = data.bgOpacity;
    if (data.selectedBackground !== undefined)
      room.selectedBackground = data.selectedBackground;
    if (data.customBackground !== undefined)
      room.customBackground = data.customBackground;

    // Log activity
    if (!room.activityLog) room.activityLog = [];
    room.activityLog.push({
      type: "appearance-change",
      oderId: socket.id,
      userName: userName,
      details: data,
      timestamp: Date.now(),
    });

    // Broadcast to all OTHER users in room
    socket.to(roomId).emit("appearance-change", {
      ...data,
      senderId: socket.id,
    });

    console.log(`🎨 Room ${roomId}: Appearance changed by ${userName}`);
  });

  socket.on("personal-settings-change", (roomId, data) => {
    const room = getRoom(roomId);
    if (!room) return;

    console.log("👤 Personal settings received:", data);

    // Get user name for logging
    const user = room.users.find((u) => u.id === socket.id);
    const userName = user?.name || "Unknown";

    // Update room personal settings
    if (data.chatColor !== undefined) room.chatColor = data.chatColor;
    if (data.chatAnimation !== undefined)
      room.chatAnimation = data.chatAnimation;
    if (data.fontSize !== undefined) room.fontSize = data.fontSize;

    if (data.notifyOnJoin !== undefined) room.notifyOnJoin = data.notifyOnJoin;
    if (data.notifyOnMessage !== undefined)
      room.notifyOnMessage = data.notifyOnMessage;
    if (data.notifyOnVideoControl !== undefined)
      room.notifyOnVideoControl = data.notifyOnVideoControl;

    // Log activity
    if (!room.activityLog) room.activityLog = [];
    room.activityLog.push({
      type: "personal-settings-change",
      oderId: socket.id,
      userName: userName,
      details: data,
      timestamp: Date.now(),
    });

    // Broadcast to all OTHER users in room
    socket.to(roomId).emit("personal-settings-change", {
      ...data,
      senderId: socket.id,
    });

    console.log(`👤 Room ${roomId}: Personal settings changed by ${socket.id}`);
  });

  socket.on("room-settings-change", (roomId, data) => {
    const room = getRoom(roomId);
    if (!room) {
      console.log("❌ Room not found:", roomId);
      return;
    }

    // Only host can change room settings
    if (socket.id !== room.host) {
      console.log("❌ Non-host tried to change room settings");
      socket.emit("error-message", {
        message: "Only host can change room settings",
      });
      return;
    }

    console.log("🏠 Room settings received:", data);
    console.log("🏠 Before update - maxParticipants:", room.maxParticipants);

    // Update room settings
    if (data.roomName !== undefined) room.roomName = data.roomName;
    if (data.roomPrivacy !== undefined) room.roomPrivacy = data.roomPrivacy;
    if (data.maxParticipants !== undefined)
      room.maxParticipants = data.maxParticipants;
    if (data.saveRoom !== undefined) room.saveRoom = data.saveRoom;

    console.log("🏠 After update - maxParticipants:", room.maxParticipants);

    // Broadcast to all OTHER users in room
    socket.to(roomId).emit("room-settings-change", {
      ...data,
      senderId: socket.id,
    });

    console.log(`🏠 Room ${roomId}: Room settings changed by ${socket.id}`);
  });

  socket.on("host-controls-change", (roomId, data) => {
    const room = getRoom(roomId);
    if (!room) return;

    // Only host can change
    if (socket.id !== room.host) {
      socket.emit("error-message", {
        message: "Only host can change these settings",
      });
      return;
    }

    console.log("👑 Host controls received:", data);

    // Permission Controls
    if (data.allowGuestsToChat !== undefined)
      room.allowGuestsToChat = data.allowGuestsToChat;
    if (data.allowGuestsToChangeVideo !== undefined)
      room.allowGuestsToChangeVideo = data.allowGuestsToChangeVideo;
    if (data.allowGuestsToControlPlayback !== undefined)
      room.allowGuestsToControlPlayback = data.allowGuestsToControlPlayback;
    if (data.allowGuestsToChangeSettings !== undefined)
      room.allowGuestsToChangeSettings = data.allowGuestsToChangeSettings;
    if (data.allowGuestsToShareScreen !== undefined)
      room.allowGuestsToShareScreen = data.allowGuestsToShareScreen;
    if (data.allowGuestsToUseCamera !== undefined)
      room.allowGuestsToUseCamera = data.allowGuestsToUseCamera;
    if (data.allowGuestsToUseMic !== undefined)
      room.allowGuestsToUseMic = data.allowGuestsToUseMic;

    // Room Controls
    if (data.requireApproval !== undefined)
      room.requireApproval = data.requireApproval;
    if (data.isRoomLocked !== undefined) room.isRoomLocked = data.isRoomLocked;
    if (data.roomPassword !== undefined) room.roomPassword = data.roomPassword;

    // Moderation Controls
    if (data.slowModeEnabled !== undefined)
      room.slowModeEnabled = data.slowModeEnabled;
    if (data.slowModeInterval !== undefined)
      room.slowModeInterval = data.slowModeInterval;
    if (data.wordFilterEnabled !== undefined)
      room.wordFilterEnabled = data.wordFilterEnabled;
    if (data.blockedWords !== undefined) room.blockedWords = data.blockedWords;
    if (data.linksFilterEnabled !== undefined)
      room.linksFilterEnabled = data.linksFilterEnabled;
    if (data.emojisOnlyMode !== undefined)
      room.emojisOnlyMode = data.emojisOnlyMode;

    // Log activity
    room.activityLog.push({
      type: "settings-change",
      userId: socket.id,
      userName: room.users.find((u) => u.id === socket.id)?.name || "Host",
      details: data,
      timestamp: Date.now(),
    });

    // Broadcast to all users
    io.to(roomId).emit("host-controls-change", {
      ...data,
      senderId: socket.id,
    });

    console.log(`👑 Room ${roomId}: Host controls changed`);
  });

  socket.on("kick-user", (roomId, userId) => {
    const room = getRoom(roomId);
    if (!room) return;

    if (socket.id !== room.host) {
      socket.emit("error-message", { message: "Only host can kick users" });
      return;
    }

    const userToKick = room.users.find((u) => u.id === userId);
    if (!userToKick) return;

    console.log(`👢 Kicking user: ${userToKick.name}`);

    // Log activity
    room.activityLog.push({
      type: "user-kicked",
      oderId: socket.id,
      userName: userToKick.name,
      timestamp: Date.now(),
    });

    // Notify the kicked user
    io.to(userId).emit("you-were-kicked", {
      message: "You have been removed from the room by the host.",
    });

    // Remove user from room
    room.users = room.users.filter((u) => u.id !== userId);

    // Notify everyone else
    socket.to(roomId).emit("user-kicked", {
      id: userId,
      name: userToKick.name,
    });
  });

  socket.on("update-mute-status", (roomId, isMuted) => {
    const room = getRoom(roomId);
    if (!room) return;

    const user = room.users.find((u) => u.id === socket.id);
    if (user) {
      user.isMuted = isMuted;
      io.to(roomId).emit("user-updated", { id: socket.id, isMuted });
    }
  });

  socket.on("change-name", (roomId, newName) => {
    const room = getRoom(roomId);
    if (!room) return;

    const user = room.users.find((u) => u.id === socket.id);
    if (!user) return;

    const oldName = user.name;
    user.name = newName.trim() || oldName;

    // Log activity
    if (!room.activityLog) room.activityLog = [];
    room.activityLog.push({
      type: "name-change",
      userId: socket.id,
      oldName: oldName,
      newName: user.name,
      timestamp: Date.now(),
    });

    // Broadcast to all users
    io.to(roomId).emit("user-name-changed", {
      userId: socket.id,
      clientId: user.clientId,
      oldName: oldName,
      newName: user.name,
    });

    console.log(`✏️ Room ${roomId}: ${oldName} changed name to ${user.name}`);
  });

  socket.on("update-camera-status", (roomId, isCameraMuted) => {
    const room = getRoom(roomId);
    if (!room) return;

    const user = room.users.find((u) => u.id === socket.id);
    if (user) {
      user.isCameraMuted = isCameraMuted;
      io.to(roomId).emit("user-camera-updated", {
        userId: socket.id,
        isCameraMuted,
      });
      console.log(`📹 ${user.name}: Camera ${isCameraMuted ? "OFF" : "ON"}`);
    }
  });

  socket.on("ban-user", (roomId, userId) => {
    const room = getRoom(roomId);
    if (!room) return;

    if (socket.id !== room.host) {
      socket.emit("error-message", { message: "Only host can ban users" });
      return;
    }

    const userToBan = room.users.find((u) => u.id === userId);
    if (!userToBan) return;

    console.log(`🚫 Banning user: ${userToBan.name}`);

    // Add to banned list
    room.bannedUsers.push({
      clientId: userToBan.clientId,
      name: userToBan.name,
      bannedAt: Date.now(),
    });

    // Log activity
    room.activityLog.push({
      type: "user-banned",
      oderId: socket.id,
      userName: userToBan.name,
      timestamp: Date.now(),
    });

    // Notify the banned user
    io.to(userId).emit("you-were-banned", {
      message: "You have been banned from this room.",
    });

    // Remove user from room
    room.users = room.users.filter((u) => u.id !== userId);

    // Notify everyone else
    socket.to(roomId).emit("user-banned", {
      id: userId,
      name: userToBan.name,
    });
  });

  socket.on("transfer-host", (roomId, newHostId) => {
    const room = getRoom(roomId);
    if (!room) return;

    if (socket.id !== room.host) {
      socket.emit("error-message", { message: "Only host can transfer host" });
      return;
    }

    const newHost = room.users.find((u) => u.id === newHostId);
    if (!newHost) return;

    const oldHostName =
      room.users.find((u) => u.id === socket.id)?.name || "Host";

    console.log(`👑 Transferring host to: ${newHost.name}`);

    // Update old host
    const oldHost = room.users.find((u) => u.id === socket.id);
    if (oldHost) oldHost.isHost = false;

    // Update new host
    newHost.isHost = true;
    room.host = newHostId;
    room.hostClientId = newHost.clientId;

    // Log activity
    room.activityLog.push({
      type: "host-transferred",
      fromUser: oldHostName,
      toUser: newHost.name,
      timestamp: Date.now(),
    });

    // Notify new host
    io.to(newHostId).emit("host-assigned", {
      message: "You are now the host of this room!",
    });

    // Notify old host
    socket.emit("host-transferred", {
      message: `You transferred host to ${newHost.name}`,
    });

    // Broadcast to all
    io.to(roomId).emit("room-state-update", {
      users: room.users.filter((u) => !u.isDisconnected),
      host: room.host,
      hostClientId: room.hostClientId,
    });
  });

  socket.on("mute-all", (roomId, muteState) => {
    const room = getRoom(roomId);
    if (!room) return;

    if (socket.id !== room.host) {
      socket.emit("error-message", { message: "Only host can mute all" });
      return;
    }

    console.log(
      `🔇 ${muteState ? "Muting" : "Unmuting"} all users in room ${roomId}`
    );

    // Store the mute all state
    room.allMuted = muteState;

    // Mute/unmute all users except host
    room.users.forEach((user) => {
      if (user.id !== socket.id) {
        user.isMuted = muteState;
      }
    });

    // Log activity
    if (!room.activityLog) room.activityLog = [];
    room.activityLog.push({
      type: muteState ? "mute-all" : "unmute-all",
      oderId: socket.id,
      userName: room.users.find((u) => u.id === socket.id)?.name || "Host",
      timestamp: Date.now(),
    });

    // Notify all users
    io.to(roomId).emit("all-muted", {
      muted: muteState,
      message: muteState
        ? "Host has muted all participants"
        : "Host has unmuted all participants",
    });

    // Broadcast updated user list
    io.to(roomId).emit("room-state-update", {
      users: room.users.filter((u) => !u.isDisconnected),
      allMuted: room.allMuted,
    });
  });

  socket.on("clear-chat", (roomId) => {
    const room = getRoom(roomId);
    if (!room) return;

    if (socket.id !== room.host) {
      socket.emit("error-message", { message: "Only host can clear chat" });
      return;
    }

    console.log(`🧹 Clearing chat in room ${roomId}`);

    // CLEAR STORED MESSAGES
    room.messages = [];

    // Log activity
    room.activityLog.push({
      type: "chat-cleared",
      userId: socket.id,
      timestamp: Date.now(),
    });

    // Notify all users to clear their chat
    io.to(roomId).emit("chat-cleared", {
      message: "Chat has been cleared by the host",
    });
  });

  socket.on("close-room", (roomId) => {
    const room = getRoom(roomId);
    if (!room) return;

    if (socket.id !== room.host) {
      socket.emit("error-message", { message: "Only host can close room" });
      return;
    }

    console.log(`🚪 Closing room ${roomId}`);

    // Notify all users
    io.to(roomId).emit("room-closed", {
      message: "This room has been closed by the host.",
    });

    // Remove all users from room
    room.users.forEach((user) => {
      const userSocket = io.sockets.sockets.get(user.id);
      if (userSocket) {
        userSocket.leave(roomId);
      }
    });

    // Delete room
    delete rooms[roomId];
    console.log(`🗑️ Room ${roomId} deleted by host`);
  });

  socket.on("get-activity-log", (roomId) => {
    const room = getRoom(roomId);
    if (!room) return;

    if (socket.id !== room.host) {
      socket.emit("error-message", {
        message: "Only host can view activity log",
      });
      return;
    }

    socket.emit("activity-log", {
      log: room.activityLog,
    });
  });

  // Host approves a join request
  socket.on("approve-join", (roomId, oderId) => {
    const room = getRoom(roomId);
    if (!room) return;

    // Only host can approve
    if (socket.id !== room.host) {
      console.log("❌ Non-host tried to approve");
      return;
    }

    // Find pending user
    if (!room.pendingUsers) room.pendingUsers = [];
    const pendingIndex = room.pendingUsers.findIndex((u) => u.id === oderId);
    if (pendingIndex === -1) {
      console.log("❌ User not found in pending list");
      return;
    }

    const user = room.pendingUsers[pendingIndex];

    // Remove from pending
    room.pendingUsers.splice(pendingIndex, 1);

    // Add to users
    room.users.push(user);

    // Log activity
    if (!room.activityLog) room.activityLog = [];
    room.activityLog.push({
      type: "user-approved",
      oderId: socket.id,
      userName: user.name,
      approvedBy: room.users.find((u) => u.id === socket.id)?.name || "Host",
      timestamp: Date.now(),
    });

    console.log(`✅ User approved: ${user.name}`);

    // Send room state to approved user
    io.to(oderId).emit("join-approved", {
      message: "Your request was approved!",
    });

    io.to(oderId).emit("room-state", {
      messages: room.messages || [],
      // Video state
      videoId: room.videoId,
      platform: room.platform,
      currentTime: room.currentTime,
      isPlaying: room.isPlaying,
      isLocked: room.isLocked,
      playbackRate: room.playbackRate,
      videoQuality: room.videoQuality,

      // Appearance settings
      bgColor: room.bgColor,
      bgOpacity: room.bgOpacity,
      selectedBackground: room.selectedBackground,
      customBackground: room.customBackground,

      // Personal/Chat settings
      chatColor: room.chatColor,
      chatAnimation: room.chatAnimation,
      fontSize: room.fontSize,

      // Notification settings
      notifyOnJoin: room.notifyOnJoin,
      notifyOnMessage: room.notifyOnMessage,
      notifyOnVideoControl: room.notifyOnVideoControl,

      // Room settings
      roomName: room.roomName,
      roomPrivacy: room.roomPrivacy,
      maxParticipants: room.maxParticipants,
      saveRoom: room.saveRoom,

      // Host Controls
      requireApproval: room.requireApproval,
      isRoomLocked: room.isRoomLocked,
      roomPassword: room.roomPassword,
      allowGuestsToChat: room.allowGuestsToChat,
      allowGuestsToShareScreen: room.allowGuestsToShareScreen,
      allowGuestsToUseCamera: room.allowGuestsToUseCamera,
      allowGuestsToUseMic: room.allowGuestsToUseMic,
      slowModeEnabled: room.slowModeEnabled,
      slowModeInterval: room.slowModeInterval,
      wordFilterEnabled: room.wordFilterEnabled,
      blockedWords: room.blockedWords,
      linksFilterEnabled: room.linksFilterEnabled,
      emojisOnlyMode: room.emojisOnlyMode,
      allMuted: room.allMuted,

      // Users and host info
      users: room.users.filter((u) => !u.isDisconnected),
      host: room.host,
      hostClientId: room.hostClientId,
      userId: oderId,
      isHost: false,
      pendingUsers: [],
    });

    // Notify everyone about new user
    io.to(roomId).emit("user-joined", user);

    // Broadcast updated room state to everyone
    io.to(roomId).emit("room-state-update", {
      users: room.users.filter((u) => !u.isDisconnected),
      host: room.host,
      hostClientId: room.hostClientId,
    });

    // Update host's pending list
    socket.emit("pending-users-update", {
      pendingUsers: room.pendingUsers,
    });

    console.log(
      `📊 Room ${roomId}: ${
        room.users.filter((u) => !u.isDisconnected).length
      } active users`
    );
  });

  // Host rejects a join request
  socket.on("reject-join", (roomId, oderId, reason) => {
    const room = getRoom(roomId);
    if (!room) return;

    // Only host can reject
    if (socket.id !== room.host) {
      console.log("❌ Non-host tried to reject");
      return;
    }

    // Find pending user
    if (!room.pendingUsers) room.pendingUsers = [];
    const pendingIndex = room.pendingUsers.findIndex((u) => u.id === oderId);
    if (pendingIndex === -1) {
      console.log("❌ User not found in pending list");
      return;
    }

    const user = room.pendingUsers[pendingIndex];

    // Remove from pending
    room.pendingUsers.splice(pendingIndex, 1);

    // Log activity
    if (!room.activityLog) room.activityLog = [];
    room.activityLog.push({
      type: "user-rejected",
      oderId: socket.id,
      userName: user.name,
      rejectedBy: room.users.find((u) => u.id === socket.id)?.name || "Host",
      timestamp: Date.now(),
    });

    console.log(`❌ User rejected: ${user.name}`);

    // Notify rejected user
    io.to(oderId).emit("join-rejected", {
      message: reason || "Your request was declined by the host.",
    });

    // Update host's pending list
    socket.emit("pending-users-update", {
      pendingUsers: room.pendingUsers,
    });
  });

  socket.on("leave-room", (roomId) => {
    console.log(`🚪 User explicitly leaving: ${socket.id}`);
    socket.leave(roomId);

    const room = getRoom(roomId);
    if (!room) return;

    const leavingUser = room.users.find((u) => u.id === socket.id);
    if (!leavingUser) return;

    // Remove user completely on explicit leave
    room.users = room.users.filter((u) => u.id !== socket.id);

    // Transfer host if needed
    if (room.host === socket.id && room.users.length > 0) {
      const activeUsers = room.users.filter((u) => !u.isDisconnected);
      if (activeUsers.length > 0) {
        const newHost = activeUsers[0];
        room.host = newHost.id;
        room.hostClientId = newHost.clientId;
        newHost.isHost = true;

        io.to(newHost.id).emit("host-assigned", {
          message: "You are now the host",
        });
        console.log(`👑 New host: ${newHost.name}`);
      }
    }

    io.to(roomId).emit("user-left", {
      id: socket.id,
      clientId: leavingUser.clientId,
      name: leavingUser.name,
    });

    if (room.users.length === 0) {
      delete rooms[roomId];
      console.log(`🗑️ Room ${roomId} deleted`);
    }

    currentRoomId = null;
  });

  socket.on("disconnect", (reason) => {
    console.log("🔴 Disconnected:", socket.id, "Reason:", reason);

    if (!currentRoomId) return;

    const room = getRoom(currentRoomId);
    if (!room) return;

    const user = room.users.find((u) => u.id === socket.id);
    if (!user) return;

    // Clean up typing status
    if (currentRoomId && typingUsers[currentRoomId]) {
      delete typingUsers[currentRoomId][socket.id];

      // Broadcast updated typing list
      socket.to(currentRoomId).emit("user-stopped-typing", {
        oderId: socket.id,
        typingUsers: Object.values(typingUsers[currentRoomId]),
      });
    }

    // Clean up video call
    if (currentRoomId) {
      const room = getRoom(currentRoomId);
      if (room && room.videoCallParticipants) {
        room.videoCallParticipants = room.videoCallParticipants.filter(
          (id) => id !== socket.id
        );

        // Notify others that user left video call
        socket.to(currentRoomId).emit("video-user-left", {
          oderId: socket.id,
        });
      }
    }

    // Mark as disconnected, don't remove yet
    user.isDisconnected = true;
    user.disconnectedAt = Date.now();

    console.log(`⏳ Waiting for reconnect: ${user.name}`);

    // Remove after 30 seconds if no reconnect
    const roomIdToCheck = currentRoomId;
    const userClientId = user.clientId;

    setTimeout(() => {
      const currentRoom = getRoom(roomIdToCheck);
      if (!currentRoom) return;

      const userToRemove = currentRoom.users.find(
        (u) => u.clientId === userClientId && u.isDisconnected
      );

      if (userToRemove) {
        console.log(`⏰ Removing inactive user: ${userToRemove.name}`);

        currentRoom.users = currentRoom.users.filter(
          (u) => u.clientId !== userClientId
        );

        // Transfer host if needed
        if (currentRoom.hostClientId === userClientId) {
          const activeUsers = currentRoom.users.filter(
            (u) => !u.isDisconnected
          );
          if (activeUsers.length > 0) {
            const newHost = activeUsers[0];
            currentRoom.host = newHost.id;
            currentRoom.hostClientId = newHost.clientId;
            newHost.isHost = true;

            io.to(newHost.id).emit("host-assigned", {
              message: "You are now the host",
            });
          }
        }

        io.to(roomIdToCheck).emit("user-left", {
          id: userToRemove.id,
          name: userToRemove.name,
        });

        if (currentRoom.users.length === 0) {
          delete rooms[roomIdToCheck];
          console.log(`🗑️ Room ${roomIdToCheck} deleted`);
        } else {
          broadcastRoomState(roomIdToCheck);
        }
      }
    }, 30000);
  });
});

app.use(errorMiddleware);

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
