import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    content: {
      type: String,
      trim: true,
    },
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    readBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    // For file attachments (optional)
    attachment: {
      type: String,
    },
    attachmentType: {
      type: String,
      enum: ["image", "video", "document", "audio", null],
      default: null,
    },
  },
  { timestamps: true }
);

export const Message = mongoose.model("Message", messageSchema);