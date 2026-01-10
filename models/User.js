import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";

const userSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ["user", "admin"],
    default: "user",
  },
  name: {
    type: String,
    required: [true, "Name is required"],
  },
  email: {
    type: String,
    required: [true, "Email is required"],
    unique: true,
    lowercase: true,
  },
  password: {
    type: String,
    minLength: [6, "Password must have at least 6 characters."],
    maxLength: [128, "Password cannot have more than 128 characters."],
    select: false,
    required: function () {
      return !this.signUpWithGoogle;
    },
  },
  phone: {
    type: String,
    sparse: true,
  },
  image: String,
  accountVerified: {
    type: Boolean,
    default: function () {
      return this.signUpWithGoogle || false;
    },
  },
  emailVerificationToken: String,
  emailVerificationExpire: Date,
  resetPasswordToken: String,
  resetPasswordExpire: Date,
  createdAt: {
    type: Date,
    default: Date.now,
  },
  avatar: {
    type: String,
    default: "",
  },
  last_login_date: {
    type: Date,
    default: null,
  },
   username: {
    type: String,
    unique: true, 
    sparse: true,
    trim: true
  },
  bio: {
    type: String,
    default: "TogetherTime user"
  },
  location: {
    type: String,
    default: ""
  },
  followers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  }],
  following: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  }],
  watch_hours: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ["active", "inactive", "suspended"],
    default: function () {
      return this.signUpWithGoogle ? "active" : "inactive";
    },
  },
  // New watch party specific fields
  rooms_created: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
    },
  ],
  rooms_joined: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
    },
  ],
  watch_history: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Video",
    },
  ],
  signUpWithGoogle: {
    type: Boolean,
    default: false,
  },
  hasGooglePassword: {
    type: Boolean,
    default: false,
  },
});

// Rest of the code remains the same
userSchema.index(
  {
    email: 1,
    accountVerified: 1,
  },
  {
    unique: true,
    partialFilterExpression: { accountVerified: true },
  }
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    return next();
  }

  if (this.password && !this.password.startsWith("$2b$")) {
    this.password = await bcrypt.hash(this.password, 10);

    if (this.signUpWithGoogle) {
      this.hasGooglePassword = true;
    }
  }

  next();
});

userSchema.methods.comparePassword = async function (enteredPassword) {
  if (this.signUpWithGoogle && !this.hasGooglePassword) {
    return false;
  }

  if (!this.password) {
    return false;
  }

  return await bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.generateVerificationCode = function () {
  function generateRandomFiveDigitNumber() {
    const firstDigit = Math.floor(Math.random() * 9) + 1;
    const remainingDigits = Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, "0");
    return parseInt(firstDigit + remainingDigits);
  }
  const verificationCode = generateRandomFiveDigitNumber();
  this.verificationCode = verificationCode;
  this.verificationCodeExpire = Date.now() + 10 * 60 * 1000;
  return verificationCode;
};

userSchema.methods.generateToken = function () {
  return jwt.sign({ id: this._id }, process.env.JWT_SECRET_KEY, {
    expiresIn: process.env.JWT_EXPIRE,
  });
};

userSchema.methods.generateEmailVerificationToken = function () {
  const token = crypto.randomBytes(20).toString("hex");

  this.emailVerificationToken = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

  // ⏱️ 10 minutes expiry
  this.emailVerificationExpire = Date.now() + 10 * 60 * 1000;

  return token;
};

export const User = mongoose.model("User", userSchema);
