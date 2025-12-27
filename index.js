// index.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", rooms: Object.keys(rooms).length });
});

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

const rooms = {}; // in-memory room storage

// Helper function to get room
const getRoom = (roomId) => rooms[roomId] || null;

// Helper function to broadcast room state
const broadcastRoomState = (roomId) => {
  const room = getRoom(roomId);
  if (room) {
    io.to(roomId).emit("room-state-update", {
      users: room.users,
      isLocked: room.isLocked,
      host: room.host,
    });
  }
};

/* ---------------- SOCKET LOGIC ---------------- */

io.on("connection", (socket) => {
  console.log("🟢 User connected:", socket.id);

  // Store current room for this socket
  let currentRoomId = null;

  socket.on("join-room", (roomId, userData) => {
    // Leave previous room if any
    if (currentRoomId && currentRoomId !== roomId) {
      socket.leave(currentRoomId);
      handleUserLeave(socket.id, currentRoomId);
    }

    socket.join(roomId);
    currentRoomId = roomId;

    // Create room if not exists
    if (!rooms[roomId]) {
      rooms[roomId] = {
        host: socket.id,
        users: [],
        videoId: null,
        platform: null,
        currentTime: 0,
        isPlaying: false,
        isLocked: false,
        lastSyncTime: Date.now(),
      };
    }

    // Create user object
    const isFirstUser = rooms[roomId].users.length === 0;
    const user = {
      id: socket.id,
      name: userData?.name || `Guest_${socket.id.slice(0, 4)}`,
      isHost: isFirstUser || rooms[roomId].host === socket.id,
      isMuted: userData?.isMuted ?? false,
      joinedAt: Date.now(),
    };

    // Update host if this is the first user
    if (isFirstUser) {
      rooms[roomId].host = socket.id;
    }

    // Check if user already exists (reconnection)
    const existingUserIndex = rooms[roomId].users.findIndex(
      (u) => u.id === socket.id
    );

    if (existingUserIndex !== -1) {
      // Update existing user
      rooms[roomId].users[existingUserIndex] = user;
    } else {
      // Add new user
      rooms[roomId].users.push(user);
    }

    // Send current room state to new user
    socket.emit("room-state", {
      ...rooms[roomId],
      userId: socket.id,
      isHost: rooms[roomId].host === socket.id,
    });

    // Notify others about new user
    socket.to(roomId).emit("user-joined", user);

    console.log(`✅ Socket ${socket.id} (${user.name}) joined room ${roomId}`);
    console.log(
      `   Room ${roomId} now has ${rooms[roomId].users.length} users`
    );
  });

  // Video playback events
  socket.on("video-play", (roomId, timestamp) => {
    const room = getRoom(roomId);
    if (!room) return;

    // Allow if user is host or room is unlocked
    if (room.host === socket.id || !room.isLocked) {
      room.isPlaying = true;
      room.currentTime = timestamp;
      room.lastSyncTime = Date.now();
      socket.to(roomId).emit("video-play", timestamp);
      console.log(`▶️ Room ${roomId}: Play at ${timestamp}s`);
    }
  });

  socket.on("video-pause", (roomId, timestamp) => {
    const room = getRoom(roomId);
    if (!room) return;

    if (room.host === socket.id || !room.isLocked) {
      room.isPlaying = false;
      room.currentTime = timestamp;
      room.lastSyncTime = Date.now();
      socket.to(roomId).emit("video-pause", timestamp);
      console.log(`⏸️ Room ${roomId}: Pause at ${timestamp}s`);
    }
  });

  socket.on("video-seek", (roomId, timestamp) => {
    const room = getRoom(roomId);
    if (!room) return;

    if (room.host === socket.id || !room.isLocked) {
      room.currentTime = timestamp;
      room.lastSyncTime = Date.now();
      socket.to(roomId).emit("video-seek", timestamp);
      console.log(`⏩ Room ${roomId}: Seek to ${timestamp}s`);
    }
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

  // Sync requests
  socket.on("request-sync", (roomId) => {
    const room = getRoom(roomId);
    if (room) {
      // Calculate adjusted time based on elapsed time since last sync
      let adjustedTime = room.currentTime;
      if (room.isPlaying) {
        const elapsed = (Date.now() - room.lastSyncTime) / 1000;
        adjustedTime = room.currentTime + elapsed;
      }

      socket.emit("sync-response", {
        videoId: room.videoId,
        platform: room.platform,
        currentTime: adjustedTime,
        isPlaying: room.isPlaying,
        isLocked: room.isLocked,
      });
    }
  });

  socket.on("sync-time", (roomId, currentTime) => {
    const room = getRoom(roomId);
    if (room && room.host === socket.id) {
      room.currentTime = currentTime;
      room.lastSyncTime = Date.now();
      socket.to(roomId).emit("sync-time", currentTime);
    }
  });

  // Periodic sync from host
  socket.on("host-sync", (roomId, syncData) => {
    const room = getRoom(roomId);
    if (room && room.host === socket.id) {
      room.currentTime = syncData.currentTime;
      room.isPlaying = syncData.isPlaying;
      room.lastSyncTime = Date.now();
      socket.to(roomId).emit("host-sync", syncData);
    }
  });

  // Chat messaging
  socket.on("send-message", (roomId, message) => {
    const room = getRoom(roomId);
    if (!room) return;

    const user = room.users.find((u) => u.id === socket.id);
    const enrichedMessage = {
      ...message,
      id: `${socket.id}-${Date.now()}`,
      userId: socket.id,
      userName: user?.name || message.user || "Unknown",
      timestamp: Date.now(),
    };

    // Broadcast to all users in room including sender
    io.to(roomId).emit("receive-message", enrichedMessage);
    console.log(
      `💬 Room ${roomId}: ${enrichedMessage.userName}: ${message.text}`
    );
  });

  // Room controls
  socket.on("toggle-lock", (roomId, isLocked) => {
    const room = getRoom(roomId);
    if (room && room.host === socket.id) {
      room.isLocked = isLocked;
      io.to(roomId).emit("room-locked", isLocked);
      console.log(`🔒 Room ${roomId}: ${isLocked ? "Locked" : "Unlocked"}`);
    }
  });

  socket.on("update-mute-status", (roomId, isMuted) => {
    const room = getRoom(roomId);
    if (!room) return;

    const user = room.users.find((u) => u.id === socket.id);
    if (user) {
      user.isMuted = isMuted;
      io.to(roomId).emit("user-updated", {
        id: socket.id,
        isMuted,
      });
    }
  });

  socket.on("leave-room", (roomId) => {
    socket.leave(roomId);
    handleUserLeave(socket.id, roomId);
    currentRoomId = null;
  });

  // Helper function to handle user leaving
  function handleUserLeave(userId, roomId) {
    const room = getRoom(roomId);
    if (!room) return;

    const leavingUser = room.users.find((u) => u.id === userId);
    room.users = room.users.filter((user) => user.id !== userId);

    // Reassign host if needed
    if (room.host === userId && room.users.length > 0) {
      room.host = room.users[0].id;
      room.users[0].isHost = true;

      // Notify the new host
      io.to(room.host).emit("host-assigned", {
        message: "You are now the host",
      });

      console.log(
        `👑 Room ${roomId}: New host assigned to ${room.users[0].name}`
      );
    }

    // Notify others that user left
    io.to(roomId).emit("user-left", {
      id: userId,
      name: leavingUser?.name || "Unknown",
    });

    // Clean up empty rooms
    if (room.users.length === 0) {
      delete rooms[roomId];
      console.log(`🗑️ Room ${roomId} deleted (empty)`);
    } else {
      console.log(
        `👋 User ${userId} left room ${roomId}. ${room.users.length} users remaining`
      );
    }
  }

  socket.on("force-play", (roomId, timestamp) => {
    const room = getRoom(roomId);
    if (!room) return;

    // Force update room state regardless of who sent it (if they have permission)
    if (room.host === socket.id || !room.isLocked) {
      console.log(`🚨 FORCE PLAY in ${roomId} at ${timestamp}s`);
      room.isPlaying = true;
      room.currentTime = timestamp;
      room.lastSyncTime = Date.now();

      // Broadcast to EVERYONE including sender
      io.to(roomId).emit("force-play", timestamp);
    }
  });

  socket.on("force-pause", (roomId, timestamp) => {
    const room = getRoom(roomId);
    if (!room) return;

    if (room.host === socket.id || !room.isLocked) {
      console.log(`🚨 FORCE PAUSE in ${roomId} at ${timestamp}s`);
      room.isPlaying = false;
      room.currentTime = timestamp;
      room.lastSyncTime = Date.now();

      // Broadcast to EVERYONE including sender
      io.to(roomId).emit("force-pause", timestamp);
    }
  });

  socket.on("disconnect", (reason) => {
    console.log("🔴 User disconnected:", socket.id, "Reason:", reason);

    // Clean up user from all rooms
    for (const roomId in rooms) {
      const userIndex = rooms[roomId].users.findIndex(
        (user) => user.id === socket.id
      );

      if (userIndex !== -1) {
        handleUserLeave(socket.id, roomId);
      }
    }
  });
});

/* ---------------- SERVER START ---------------- */

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🚀 Socket server running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
});
