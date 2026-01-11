import ErrorHandler from "../middlewares/error.js";
import { catchAsyncError } from "../middlewares/catchAsyncError.js";
import { sendEmail } from "../utils/sendEmail.js";
import { sendToken } from "../utils/sendToken.js";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { User } from "../models/User.js";
import { connection, getCollection } from "../database/db.js";
import cloudinary from "../utils/cloudinary.js";
import fs from "fs";

// Register new user
export const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    console.log("Registration attempt for:", email);

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required.",
      });
    }

    // Ensure database is connected
    await connection();

    // Get users collection directly
    const UserCollection = getCollection("users");

    // Check if email already exists (verified OR unverified)
    const existingUser = await UserCollection.findOne({ email });

    if (existingUser) {
      // If user exists and is verified - reject registration
      if (existingUser.accountVerified) {
        return res.status(400).json({
          success: false,
          message: "Email is already registered. Please login instead.",
        });
      }

      // User exists but isn't verified - update the token instead of creating new user
      console.log("Found existing unverified user, updating token");

      const verificationToken = crypto.randomBytes(20).toString("hex");
      const hashedToken = crypto
        .createHash("sha256")
        .update(verificationToken)
        .digest("hex");

      console.log(
        "DEBUG: Generated new token for existing user:",
        verificationToken
      );
      console.log("DEBUG: Hashed token for DB:", hashedToken);

      await UserCollection.updateOne(
        { _id: existingUser._id },
        {
          $set: {
            emailVerificationToken: hashedToken,
            emailVerificationExpire: new Date(Date.now() + 10 * 60 * 1000),
          },
        }
      );

      // Send verification email with the updated token
      const verificationURL = `${process.env.FRONTEND_URL}/verify-email/${verificationToken}`;
      console.log("DEBUG: Email verification URL:", verificationURL);

      const message = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
          <h2 style="color: #4CAF50; text-align: center;">Verify Your Email</h2>
          <p style="font-size: 16px; color: #333;">Hi ${name},</p>
          <p style="font-size: 16px; color: #333;">Welcome to TogetherTime! Please verify your email address by clicking the button below:</p>
          <div style="text-align: center; margin: 25px 0;">
            <a href="${verificationURL}" style="display: inline-block; padding: 12px 24px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 4px; font-weight: bold;">Verify Email</a>
          </div>
          <p style="font-size: 16px; color: #333;">If the button doesn't work, you can copy and paste this link in your browser:</p>
          <p style="font-size: 14px; color: #666; word-break: break-all;">${verificationURL}</p>
          <p style="font-size: 16px; color: #333;">This link will expire in 10 minutes.</p>
          <footer style="margin-top: 30px; text-align: center; font-size: 14px; color: #999;">
            <p>Thank you,<br>TogetherTime Team</p>
          </footer>
        </div>
      `;

      try {
        await sendEmail({
          email,
          subject: "TogetherTime - Verify Your Email",
          message,
        });
        console.log("Verification email resent to:", email);
      } catch (emailError) {
        console.error("Failed to send verification email:", emailError);
      }

      return res.status(200).json({
        success: true,
        message:
          "A new verification email has been sent. Please check your inbox.",
      });
    }

    // For new users - generate verification token
    const verificationToken = crypto.randomBytes(20).toString("hex");
    const hashedToken = crypto
      .createHash("sha256")
      .update(verificationToken)
      .digest("hex");

    console.log("DEBUG: Generated token for new user:", verificationToken);
    console.log("DEBUG: Hashed token for DB:", hashedToken);

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user
    const result = await UserCollection.insertOne({
      name,
      email,
      username: email.split("@")[0], // Set initial username from email
      password: hashedPassword,
      emailVerificationToken: hashedToken,
      emailVerificationExpire: new Date(Date.now() + 10 * 60 * 1000),
      accountVerified: false,
      status: "inactive",
      role: "user",
      createdAt: new Date(),
      bio: "TogetherTime user",
      location: "",
      followers: [],
      following: [],
      watch_hours: 0,
      rooms_created: [],
      rooms_joined: [],
      watch_history: [],
    });

    const userId = result.insertedId;
    console.log("Created new user with ID:", userId);

    // Double-check that the token was stored correctly
    const newUser = await UserCollection.findOne({ _id: userId });
    console.log("DEBUG: Token stored in DB:", newUser.emailVerificationToken);
    console.log(
      "DEBUG: Token matches hashed value:",
      newUser.emailVerificationToken === hashedToken
    );

    // Send verification email
    const verificationURL = `${process.env.FRONTEND_URL}/verify-email/${verificationToken}`;
    console.log("DEBUG: Email verification URL:", verificationURL);

    const message = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
        <h2 style="color: #4CAF50; text-align: center;">Verify Your Email</h2>
        <p style="font-size: 16px; color: #333;">Hi ${name},</p>
        <p style="font-size: 16px; color: #333;">Welcome to TogetherTime! Please verify your email address by clicking the button below:</p>
        <div style="text-align: center; margin: 25px 0;">
          <a href="${verificationURL}" style="display: inline-block; padding: 12px 24px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 4px; font-weight: bold;">Verify Email</a>
        </div>
        <p style="font-size: 16px; color: #333;">If the button doesn't work, you can copy and paste this link in your browser:</p>
        <p style="font-size: 14px; color: #666; word-break: break-all;">${verificationURL}</p>
        <p style="font-size: 16px; color: #333;">This link will expire in 10 minutes.</p>
        <footer style="margin-top: 30px; text-align: center; font-size: 14px; color: #999;">
          <p>Thank you,<br>TogetherTime Team</p>
        </footer>
      </div>
    `;

    try {
      await sendEmail({
        email,
        subject: "TogetherTime - Verify Your Email",
        message,
      });
      console.log("Verification email sent successfully to:", email);
    } catch (emailError) {
      console.error("Failed to send verification email:", emailError);
      // Continue anyway, just log the error
    }

    return res.status(201).json({
      success: true,
      message:
        "Registration successful! Please check your email to verify your account.",
    });
  } catch (error) {
    console.error("Registration error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during registration",
      error: error.message,
    });
  }
};

// Verify email address
export const verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;
    console.log("Verifying token:", token);

    // Hash the token
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
    console.log("Hashed token for lookup:", hashedToken);

    // Get users collection
    const UserCollection = getCollection("users");

    // Look for the user
    const user = await UserCollection.findOne({
      emailVerificationToken: hashedToken,
    });

    if (!user) {
      console.log("No user found with this token");
      return res.status(400).json({
        success: false,
        message: "Invalid verification link. Please register again.",
      });
    }

    // Check if token is expired
    if (user.emailVerificationExpire < new Date()) {
      console.log("Token expired at:", user.emailVerificationExpire);
      return res.status(400).json({
        success: false,
        message: "Verification link has expired. Please register again.",
      });
    }

    // Token is valid - update user
    await UserCollection.updateOne(
      { _id: user._id },
      {
        $set: {
          accountVerified: true,
          status: "active",
          last_login_date: new Date(),
        },
        $unset: {
          emailVerificationToken: "",
          emailVerificationExpire: "",
        },
      }
    );

    console.log("User verified successfully:", user.email);

    // Get updated user
    const updatedUser = await UserCollection.findOne({ _id: user._id });

    // Send token
    sendToken(
      updatedUser,
      200,
      "Email verified successfully! Welcome to TogetherTime.",
      res
    );
  } catch (error) {
    console.error("Verification error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during verification",
      error: error.message,
    });
  }
};

// Login with email/password
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate inputs
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    // Ensure database is connected
    await connection();

    // Get users collection
    const UserCollection = getCollection("users");

    // Find user with verified account
    const user = await UserCollection.findOne({
      email,
      accountVerified: true,
    });

    // Check if user exists
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Email is not registered. Please sign up first.",
      });
    }

    // Check if account is suspended
    if (user.status === "suspended") {
      return res.status(403).json({
        success: false,
        message: "Your account has been suspended.",
      });
    }

    // Validate password manually
    const isPasswordMatched = await bcrypt.compare(password, user.password);

    if (!isPasswordMatched) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    // Update login status
    await UserCollection.updateOne(
      { _id: user._id },
      {
        $set: {
          status: "active",
          last_login_date: new Date(),
        },
      }
    );

    // Get updated user
    const updatedUser = await UserCollection.findOne({ _id: user._id });

    // Generate token and send response
    sendToken(updatedUser, 200, "Login successful", res);
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during login",
      error: error.message,
    });
  }
};

// Firebase Google Auth
export const firebaseGoogleAuth = async (req, res) => {
  try {
    const { name, email, photoURL } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required for authentication",
      });
    }

    // Ensure database is connected
    await connection();

    // Get users collection directly
    const UserCollection = getCollection("users");

    // Check if user exists
    const existingUser = await UserCollection.findOne({ email });

    let userId;
    if (existingUser) {
      // Update user
      console.log("Updating existing user:", email);
      await UserCollection.updateOne(
        { email },
        {
          $set: {
            avatar: photoURL || existingUser.avatar,
            status: "active",
            last_login_date: new Date(),
            signUpWithGoogle: true,
            accountVerified: true,
          },
        }
      );
      userId = existingUser._id;
    } else {
      // Create username from email (before @ symbol)
      const username = email.split("@")[0];

      // Insert new user with all profile fields
      console.log("Creating new user:", email);
      const result = await UserCollection.insertOne({
        name: name || "Google User",
        email,
        password: "",
        username: username, // Set username from email
        avatar: photoURL || "",
        signUpWithGoogle: true,
        accountVerified: true,
        status: "active",
        role: "user",
        last_login_date: new Date(),
        createdAt: new Date(),
        // New profile fields
        bio: "TogetherTime user",
        location: "",
        followers: [],
        following: [],
        watch_hours: 0,
        rooms_created: [],
        rooms_joined: [],
        watch_history: [],
      });
      userId = result.insertedId;
    }

    // Get the user document
    const user = await UserCollection.findOne({ _id: userId });

    // Use sendToken utility
    sendToken(user, 200, "Google login successful", res);
  } catch (error) {
    console.error("Google Auth Error:", error);
    return res.status(500).json({
      success: false,
      message: `Server error: ${error.message}`,
    });
  }
};

// Logout user
export const logout = async (req, res) => {
  try {
    // Clear the token cookie by setting an expired one
    res
      .status(200)
      .cookie("token", "", {
        expires: new Date(Date.now()),
        httpOnly: true,
      })
      .json({
        success: true,
        message: "Logged out successfully.",
      });
  } catch (error) {
    console.error("Logout error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during logout",
      error: error.message,
    });
  }
};

// Forgot password
export const forgotPassword = catchAsyncError(async (req, res, next) => {
  const { email } = req.body;

  if (!email) {
    return next(new ErrorHandler("Email is required", 400));
  }

  const user = await User.findOne({
    email,
    accountVerified: true,
  });

  if (!user) {
    return next(new ErrorHandler("User not found", 404));
  }

  if (user.status === "suspended") {
    return next(new ErrorHandler("This account has been suspended.", 403));
  }

  // Generate reset token
  const resetToken = crypto.randomBytes(20).toString("hex");
  user.resetPasswordToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");
  user.resetPasswordExpire = Date.now() + 15 * 60 * 1000; // 15 minutes

  await user.save({ validateBeforeSave: false });

  // Create password reset URL
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

  // Send email
  const message = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
      <h2 style="color: #4CAF50; text-align: center;">Reset Your Password</h2>
      <p style="font-size: 16px; color: #333;">You requested a password reset for your TogetherTime account.</p>
      <div style="text-align: center; margin: 25px 0;">
        <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 4px; font-weight: bold;">Reset Password</a>
      </div>
      <p style="font-size: 16px; color: #333;">If you didn't request this, please ignore this email.</p>
      <p style="font-size: 16px; color: #333;">The reset link will expire in 15 minutes.</p>
    </div>
  `;

  try {
    await sendEmail({
      email: user.email,
      subject: "TogetherTime - Password Reset",
      message,
    });

    res.status(200).json({
      success: true,
      message: "Password reset email sent successfully",
    });
  } catch (error) {
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save({ validateBeforeSave: false });

    return next(
      new ErrorHandler("Failed to send reset email. Please try again.", 500)
    );
  }
});

// Reset Password
export const resetPassword = catchAsyncError(async (req, res, next) => {
  const { token } = req.params;
  const { password, confirmPassword } = req.body;

  if (password !== confirmPassword) {
    return next(new ErrorHandler("Passwords do not match", 400));
  }

  // Get hashed token
  const resetPasswordToken = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

  const user = await User.findOne({
    resetPasswordToken,
    resetPasswordExpire: { $gt: Date.now() },
  });

  if (!user) {
    return next(new ErrorHandler("Invalid or expired reset token", 400));
  }

  // Update password
  user.password = password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpire = undefined;
  user.status = "active";
  user.last_login_date = new Date();

  await user.save();

  sendToken(user, 200, "Password reset successful", res);
});

// Get current user
export const getMe = catchAsyncError(async (req, res, next) => {
  // Get users collection
  const UserCollection = getCollection("users");

  // Find the user by ID
  const user = await UserCollection.findOne({ _id: req.user._id });

  if (!user) {
    return next(new ErrorHandler("User not found", 404));
  }

  // Format response data to match what frontend expects
  const userData = {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    accountVerified: user.accountVerified,
    createdAt: user.createdAt,
    last_login_date: user.last_login_date,

    // Additional profile fields
    displayName: user.name,
    username: user.username || user.email.split("@")[0], // Fallback
    bio: user.bio || "TogetherTime user",
    avatar: user.avatar || "",
    location: user.location || "",
    followers: user.followers?.length || 0,
    following: user.following?.length || 0,
    watch_hours: user.watch_hours || 0,

    // Array data
    rooms_created: user.rooms_created || [],
    rooms_joined: user.rooms_joined || [],
    watch_history: user.watch_history || [],
  };

  res.status(200).json({
    success: true,
    user: userData,
  });
});

export const getAllUsers = catchAsyncError(async (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  // Get users collection
  const UserCollection = getCollection("users");

  // Find verified active users
  const users = await UserCollection.find({
    accountVerified: true,
    status: { $ne: "suspended" },
  })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();

  // Count total users for pagination
  const total = await UserCollection.countDocuments({
    accountVerified: true,
    status: { $ne: "suspended" },
  });

  // Format user data for response
  const formattedUsers = users.map((user) => ({
    _id: user._id,
    name: user.name,
    username: user.username || user.email.split("@")[0],
    email: user.email,
    avatar: user.avatar || "",
    bio: user.bio || "",
    isCurrentUser: user._id.toString() === req.user._id.toString(),
  }));

  res.status(200).json({
    success: true,
    users: formattedUsers,
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
      limit,
    },
  });
});

export const updatePassword = catchAsyncError(async (req, res, next) => {
  const userId = req.user._id;
  const { currentPassword, newPassword, confirmPassword } = req.body;

  if (!userId) {
    return next(new ErrorHandler("User ID not found.", 400));
  }

  if (!newPassword || !confirmPassword) {
    return next(
      new ErrorHandler("New password and confirm password are required.", 400)
    );
  }

  if (newPassword !== confirmPassword) {
    return next(new ErrorHandler("New passwords do not match.", 400));
  }

  if (newPassword.length < 6) {
    return next(
      new ErrorHandler("New password must be at least 6 characters long.", 400)
    );
  }

  if (newPassword.length > 128) {
    return next(
      new ErrorHandler("New password cannot exceed 128 characters.", 400)
    );
  }

  try {
    // Get users collection
    const UserCollection = getCollection("users");

    // Get current user with password
    const user = await UserCollection.findOne({ _id: userId });

    if (!user) {
      return next(new ErrorHandler("User not found.", 404));
    }

    // Check if user has a password (for social login users)
    if (user.signUpWithGoogle && !user.hasGooglePassword) {
      // If Google user without password, just set the new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      await UserCollection.updateOne(
        { _id: userId },
        {
          $set: {
            password: hashedPassword,
            hasGooglePassword: true,
          },
        }
      );

      return res.status(200).json({
        success: true,
        message: "Password set successfully.",
      });
    }

    // If user has existing password, require current password
    if (!currentPassword) {
      return next(new ErrorHandler("Current password is required.", 400));
    }

    if (currentPassword === newPassword) {
      return next(
        new ErrorHandler(
          "New password must be different from current password.",
          400
        )
      );
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password
    );
    if (!isCurrentPasswordValid) {
      return next(new ErrorHandler("Current password is incorrect.", 400));
    }

    // Hash and update the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await UserCollection.updateOne(
      { _id: userId },
      { $set: { password: hashedPassword } }
    );

    res.status(200).json({
      success: true,
      message: "Password changed successfully.",
    });
  } catch (error) {
    console.error("Password change error:", error);
    return next(
      new ErrorHandler("Failed to change password. Please try again.", 500)
    );
  }
});

export const updateProfile = catchAsyncError(async (req, res, next) => {
  const userId = req.user._id;
  const { name, username, bio } = req.body;

  if (!userId) {
    return next(new ErrorHandler("User ID not found", 400));
  }

  if (!name || !username) {
    return next(new ErrorHandler("Name and username are required", 400));
  }

  // Limit bio length
  if (bio && bio.length > 150) {
    return next(new ErrorHandler("Bio cannot exceed 150 characters", 400));
  }

  try {
    // Get users collection
    const UserCollection = getCollection("users");

    // Check if username is already taken by another user
    if (username !== req.user.username) {
      const existingUser = await UserCollection.findOne({ 
        username, 
        _id: { $ne: userId } 
      });

      if (existingUser) {
        return next(new ErrorHandler("Username is already taken", 400));
      }
    }

    // Update user profile
    await UserCollection.updateOne(
      { _id: userId },
      {
        $set: {
          name,
          username,
          bio: bio || "",
          updatedAt: new Date()
        }
      }
    );

    // Get updated user data
    const updatedUser = await UserCollection.findOne({ _id: userId });

    // Format response data to match what frontend expects
    const userData = {
      _id: updatedUser._id,
      name: updatedUser.name,
      email: updatedUser.email,
      role: updatedUser.role,
      status: updatedUser.status,
      accountVerified: updatedUser.accountVerified,
      createdAt: updatedUser.createdAt,
      last_login_date: updatedUser.last_login_date,

      // Additional profile fields
      displayName: updatedUser.name,
      username: updatedUser.username,
      bio: updatedUser.bio || "",
      avatar: updatedUser.avatar || "",
      location: updatedUser.location || "",
      followers: updatedUser.followers?.length || 0,
      following: updatedUser.following?.length || 0,
      watch_hours: updatedUser.watch_hours || 0
    };

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      user: userData
    });
  } catch (error) {
    console.error("Profile update error:", error);
    return next(new ErrorHandler("Failed to update profile. Please try again.", 500));
  }
});

export const userAvatarController = catchAsyncError(async (req, res, next) => {
  const userId = req.user?._id;
  const file = req.file;

  const options = {
    user_filename: true,
    unique_filename: false,
    overwrite: false,
    folder: "togethertime_avatars", // Organize in folders
    transformation: [
      { width: 300, height: 300, crop: "fill" }, // Optimize image size
      { quality: "auto" }, // Auto quality optimization
    ],
  };

  if (!userId) {
    return next(new ErrorHandler("User ID not found in request.", 400));
  }

  if (!file) {
    return next(new ErrorHandler("No image file provided.", 400));
  }

  try {
    // Get users collection
    const UserCollection = getCollection("users");
    
    // Find the user
    const user = await UserCollection.findOne({ _id: userId });

    if (!user) {
      return next(new ErrorHandler("User not found.", 404));
    }
    
    // Step 1: Get the old avatar URL to delete later
    const oldAvatarUrl = user.avatar;
    let oldPublicId = null;

    // Extract public_id from old avatar URL if it exists and is from Cloudinary
    if (oldAvatarUrl && oldAvatarUrl.includes("cloudinary.com")) {
      try {
        // Extract public_id from Cloudinary URL
        const urlParts = oldAvatarUrl.split("/");
        const uploadIndex = urlParts.findIndex((part) => part === "upload");
        if (uploadIndex !== -1 && urlParts[uploadIndex + 2]) {
          // Get folder and filename part
          const folderAndFile = urlParts.slice(uploadIndex + 2).join("/");
          // Remove file extension
          oldPublicId = folderAndFile.replace(/\.[^/.]+$/, "");
        }
      } catch (error) {
        console.warn("Could not extract public_id from old avatar URL:", error);
      }
    }

    // Step 2: Upload new image to Cloudinary
    const result = await cloudinary.uploader.upload(file.path, options);

    // Step 3: Clean up local file
    fs.unlinkSync(file.path);

    // Step 4: Update user avatar in database
    await UserCollection.updateOne(
      { _id: userId },
      { 
        $set: { 
          avatar: result.secure_url,
          updatedAt: new Date()
        } 
      }
    );
    
    // Get updated user
    const updatedUser = await UserCollection.findOne({ _id: userId });

    // Step 5: Delete old image from Cloudinary (if exists)
    if (oldPublicId) {
      try {
        await cloudinary.uploader.destroy(oldPublicId);
        console.log(`Old avatar deleted: ${oldPublicId}`);
      } catch (deleteError) {
        // Don't fail the request if old image deletion fails
        console.warn("Failed to delete old avatar:", deleteError);
      }
    }

    // Format user data for response
    const userData = {
      _id: updatedUser._id,
      name: updatedUser.name,
      displayName: updatedUser.name,
      username: updatedUser.username || updatedUser.email.split('@')[0],
      email: updatedUser.email,
      avatar: result.secure_url,
      bio: updatedUser.bio || "",
      // Include other user data as needed
    };

    res.status(200).json({
      success: true,
      message: "Avatar uploaded successfully.",
      user: userData
    });
  } catch (error) {
    console.error("Avatar upload error:", error);

    // Clean up local file if upload fails
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }

    return next(
      new ErrorHandler("Image upload failed. Please try again.", 500)
    );
  }
});

export const removeAvatar = catchAsyncError(async (req, res, next) => {
  const userId = req.user?._id;

  if (!userId) {
    return next(new ErrorHandler("User ID not found in request.", 400));
  }

  try {
    // Get users collection
    const UserCollection = getCollection("users");
    
    // Find the user
    const user = await UserCollection.findOne({ _id: userId });

    if (!user) {
      return next(new ErrorHandler("User not found.", 404));
    }
    
    // Get the avatar URL to delete from Cloudinary
    const avatarUrl = user.avatar;
    
    if (avatarUrl && avatarUrl.includes("cloudinary.com")) {
      // Extract public_id from Cloudinary URL
      try {
        const urlParts = avatarUrl.split("/");
        const uploadIndex = urlParts.findIndex((part) => part === "upload");
        if (uploadIndex !== -1 && urlParts[uploadIndex + 2]) {
          // Get folder and filename part
          const folderAndFile = urlParts.slice(uploadIndex + 2).join("/");
          // Remove file extension
          const publicId = folderAndFile.replace(/\.[^/.]+$/, "");
          
          // Delete image from Cloudinary
          await cloudinary.uploader.destroy(publicId);
        }
      } catch (error) {
        console.warn("Error deleting image from Cloudinary:", error);
        // Continue anyway - we'll still clear the avatar field
      }
    }
    
    // Clear the avatar field in the database
    await UserCollection.updateOne(
      { _id: userId },
      { 
        $set: { 
          avatar: "",
          updatedAt: new Date()
        } 
      }
    );
    
    // Get updated user
    const updatedUser = await UserCollection.findOne({ _id: userId });
    
    // Format user data for response
    const userData = {
      _id: updatedUser._id,
      name: updatedUser.name,
      displayName: updatedUser.name,
      username: updatedUser.username || updatedUser.email.split('@')[0],
      email: updatedUser.email,
      avatar: "",
      bio: updatedUser.bio || "",
      // Include other user data as needed
    };

    res.status(200).json({
      success: true,
      message: "Avatar removed successfully.",
      user: userData
    });
  } catch (error) {
    console.error("Avatar removal error:", error);
    return next(
      new ErrorHandler("Failed to remove avatar. Please try again.", 500)
    );
  }
});

export const getProfileByUsername = async (req, res) => {
  try {
    const { username } = req.query;
    
    if (!username) {
      return res.status(400).json({
        success: false,
        message: "Username is required"
      });
    }
    
    // Get users collection
    const UserCollection = getCollection("users");
    
    // Find the user by username
    const user = await UserCollection.findOne({ username });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }
    
    // Check if viewing own profile (compare with logged in user)
    const isOwnProfile = req.user ? 
      user._id.toString() === req.user._id.toString() : false;
    
    // Format response data
    const userData = {
      _id: user._id,
      name: user.name,
      displayName: user.name,
      username: user.username,
      bio: user.bio || "",
      avatar: user.avatar || "",
      joinedDate: new Date(user.createdAt).toLocaleDateString('en-US', { 
        month: 'long', year: 'numeric' 
      }),
      followers: user.followers?.length || 0,
      following: user.following?.length || 0,
      watch_hours: user.watch_hours || 0,
      rooms_created: user.rooms_created || [],
      isOwnProfile
    };
    
    return res.status(200).json({
      success: true,
      user: userData
    });
  } catch (error) {
    console.error("Error fetching profile:", error);
    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};