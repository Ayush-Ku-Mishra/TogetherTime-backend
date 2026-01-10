import express from "express";
import {
  getMyConversations,
  getConversationMessages,
  sendMessage,
  createConversation,
  searchUsers
} from "../controllers/messageController.js";

import { isAuthenticated } from "../middlewares/auth.js";

const router = express.Router();

// All routes require authentication
router.use(isAuthenticated);

// Conversations
router.get("/conversations", getMyConversations);
router.post("/conversations", createConversation);

// Messages
router.get("/conversations/:conversationId/messages", getConversationMessages);
router.post("/messages", sendMessage);

// Search users
router.get("/search", searchUsers);

export default router;