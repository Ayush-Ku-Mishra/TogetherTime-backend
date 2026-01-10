import express from "express";
import {
  getSearchSuggestions,
  addToSearchHistory,
  getSearchHistory,
  removeFromSearchHistory,
  clearSearchHistory
} from "../controllers/searchController.js";

import { isAuthenticated } from "../middlewares/auth.js";

const router = express.Router();

// All routes require authentication
router.use(isAuthenticated);

// Search suggestions
router.get("/suggestions", getSearchSuggestions);

// Search history
router.get("/history", getSearchHistory);
router.post("/history", addToSearchHistory);
router.delete("/history/:userId", removeFromSearchHistory);
router.delete("/history", clearSearchHistory);

export default router;