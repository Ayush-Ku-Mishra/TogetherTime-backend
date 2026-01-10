import express from "express";
import {
  addRecentSearch,
  getRecentSearches,
  deleteRecentSearch,
  clearRecentSearches
} from "../controllers/recentSearchController.js";

import { isAuthenticated } from "../middlewares/auth.js";

const router = express.Router();

// All routes require authentication
router.use(isAuthenticated);

// Routes
router.post("/", addRecentSearch);
router.get("/", getRecentSearches);
router.delete("/:searchedUserId", deleteRecentSearch);
router.delete("/", clearRecentSearches);

export default router;