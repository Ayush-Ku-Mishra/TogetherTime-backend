import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema(
  {
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],
    // For direct messages vs group chats
    isGroup: {
      type: Boolean,
      default: false,
    },
    // For group chats
    name: {
      type: String,
      trim: true,
    },
    // Latest message for preview
    latestMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
    // Group admin if it's a group chat
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

// Create a unique index on participants for non-group chats to prevent duplicates
conversationSchema.index(
  { participants: 1 },
  { 
    unique: true,
    partialFilterExpression: { isGroup: false }
  }
);

export const Conversation = mongoose.model("Conversation", conversationSchema);