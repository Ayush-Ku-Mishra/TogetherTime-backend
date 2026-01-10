import { User } from "../models/User.js";
import { catchAsyncError } from "./catchAsyncError.js";
import ErrorHandler from "./error.js";
import jwt from "jsonwebtoken";


export const isAuthenticated = catchAsyncError(async (req, res, next) => {
  const token = req.cookies?.token;

  if (!token) {
    return next(new ErrorHandler("Login required", 401));
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY); // Note: Use JWT_SECRET_KEY to match what we used

    // Try finding user through the model
    let user = await User.findById(decoded.id);
    
    // If not found through model, try direct MongoDB lookup
    if (!user) {
      const mongoose = (await import('mongoose')).default;
      if (mongoose.connection.readyState === 1) {
        const UserCollection = mongoose.connection.collection('users');
        user = await UserCollection.findOne({ _id: new mongoose.Types.ObjectId(decoded.id) });
        
        if (!user) {
          return next(new ErrorHandler("User not found", 404));
        }
      } else {
        return next(new ErrorHandler("Database connection issue", 500));
      }
    }

    // Check user status
    if (!user.accountVerified) {
      return next(new ErrorHandler("Please verify your email first", 401));
    }

    if (user.status === "suspended") {
      return next(new ErrorHandler("Account suspended", 403));
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    return next(new ErrorHandler("Invalid or expired token", 401));
  }
});
