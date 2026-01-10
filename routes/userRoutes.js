import express from "express";
import {
  register,
  verifyEmail,
  login,
  firebaseGoogleAuth,
  logout,
  forgotPassword,
  resetPassword,
  getMe,
  getAllUsers,
  updatePassword,
} from "../controllers/userController.js";

import { isAuthenticated } from "../middlewares/auth.js";

const router = express.Router();

// Auth
router.post("/register", register);
router.get("/verify-email/:token", verifyEmail);
router.post("/login", login);
router.post("/google", firebaseGoogleAuth);
router.get("/logout", isAuthenticated, logout);

// Password
router.post("/forgot-password", forgotPassword);
router.post("/reset-password/:token", resetPassword);

// User
router.get("/me", isAuthenticated, getMe);
router.get("/users", isAuthenticated, getAllUsers);
router.put("/update-password", isAuthenticated, updatePassword);

export default router;
