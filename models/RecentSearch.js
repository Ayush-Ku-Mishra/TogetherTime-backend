import mongoose from "mongoose";

const recentSearchSchema = new mongoose.Schema(
  {
    // User who performed the search
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // User who was searched
    searchedUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Timestamp is automatically handled by timestamps option
  },
  { 
    timestamps: true 
  }
);

// Compound index to ensure uniqueness per user and searched user
// This prevents duplicate entries and ensures we can update existing ones
recentSearchSchema.index({ user: 1, searchedUser: 1 }, { unique: true });

export const RecentSearch = mongoose.model("RecentSearch", recentSearchSchema);