// models/WatchParty.js
import mongoose from "mongoose";

const watchPartySchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, "Watch party title is required"],
    trim: true,
  },
  
  videoUrl: {
    type: String,
    required: [true, "Video URL is required"],
  },
  
  videoType: {
    type: String,
    enum: ["youtube", "vimeo", "custom"],
    default: "youtube",
  },
  
  isPrivate: {
    type: Boolean,
    default: false,
  },
  
  password: {
    type: String,
    select: false,
  },
  
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  
  participants: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  }],
  
  videoState: {
    currentTime: {
      type: Number,
      default: 0,
    },
    isPlaying: {
      type: Boolean,
      default: false,
    },
    lastUpdateTime: {
      type: Date,
      default: Date.now,
    },
  },
  
  createdAt: {
    type: Date,
    default: Date.now,
  },
  
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
  },
});

export const WatchParty = mongoose.model("WatchParty", watchPartySchema);