import { catchAsyncError } from "../middlewares/catchAsyncError.js";
import ErrorHandler from "../middlewares/error.js";
import { getCollection } from "../database/db.js";
import { ObjectId } from "mongodb";

// Get search suggestions
export const getSearchSuggestions = catchAsyncError(async (req, res, next) => {
  const { query } = req.query;

  if (!query || query.trim().length < 2) {
    return res.status(200).json({
      success: true,
      users: [],
    });
  }

  // Get user collection
  const UserCollection = getCollection("users");

  // Search for users matching query
  const users = await UserCollection.find({
    $or: [
      { name: { $regex: query, $options: "i" } },
      { username: { $regex: query, $options: "i" } },
      { email: { $regex: query, $options: "i" } },
    ],
    accountVerified: true,
    status: { $ne: "suspended" },
  })
    .limit(10)
    .toArray();

  // Format user data
  const formattedUsers = users.map((user) => ({
    _id: user._id,
    name: user.name,
    username: user.username || user.email.split("@")[0],
    avatar: user.avatar || "",
    isFollowing: false, // You can implement this based on your following logic
  }));

  res.status(200).json({
    success: true,
    users: formattedUsers,
  });
});

// Add a search to recent searches
export const addToSearchHistory = catchAsyncError(async (req, res, next) => {
  const { userId } = req.body;

  if (!userId) {
    return next(new ErrorHandler("User ID is required", 400));
  }

  // Get collections
  const SearchHistoryCollection = getCollection("searchhistory");
  const UserCollection = getCollection("users");

  // Check if the searched user exists
  const searchedUser = await UserCollection.findOne({
    _id: new ObjectId(userId),
    accountVerified: true,
    status: { $ne: "suspended" },
  });

  if (!searchedUser) {
    return next(new ErrorHandler("User not found", 404));
  }

  // Find if current user already has a search history document
  const userSearchHistory = await SearchHistoryCollection.findOne({
    user: new ObjectId(req.user._id),
  });

  if (userSearchHistory) {
    // User already has search history, update the array
    // First, remove this searched user if it exists (to avoid duplicates)
    await SearchHistoryCollection.updateOne(
      { user: new ObjectId(req.user._id) },
      { $pull: { searchedUsers: new ObjectId(userId) } }
    );

    // Now add to the beginning of the array
    await SearchHistoryCollection.updateOne(
      { user: new ObjectId(req.user._id) },
      {
        $push: {
          searchedUsers: {
            $each: [new ObjectId(userId)],
            $position: 0,
          },
        },
        $set: { updatedAt: new Date() },
      }
    );
  } else {
    // Create new document with searchedUsers array
    await SearchHistoryCollection.insertOne({
      user: new ObjectId(req.user._id),
      searchedUsers: [new ObjectId(userId)],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  res.status(200).json({
    success: true,
    message: "Added to search history",
  });
});

// Get search history for current user
export const getSearchHistory = catchAsyncError(async (req, res, next) => {
  // Get collections
  const SearchHistoryCollection = getCollection("searchhistory");
  const UserCollection = getCollection("users");

  // Get search history document for user
  const userHistory = await SearchHistoryCollection.findOne({
    user: new ObjectId(req.user._id),
  });

  if (
    !userHistory ||
    !userHistory.searchedUsers ||
    userHistory.searchedUsers.length === 0
  ) {
    return res.status(200).json({
      success: true,
      searchHistory: [],
    });
  }

  // Limit to 8 most recent
  const recentSearchIds = userHistory.searchedUsers.slice(0, 8);

  // Get user details for all searched users
  const users = await UserCollection.find({
    _id: { $in: recentSearchIds },
  }).toArray();

  // Format the response with user details
  const formattedHistory = recentSearchIds
    .map((searchId) => {
      const user = users.find((u) => u._id.toString() === searchId.toString());
      if (!user) return null;

      return {
        _id: user._id,
        name: user.name,
        username: user.username || user.email.split("@")[0],
        avatar: user.avatar || "",
      };
    })
    .filter(Boolean); // Remove null entries

  res.status(200).json({
    success: true,
    searchHistory: formattedHistory,
  });
});

// Remove a user from search history
export const removeFromSearchHistory = catchAsyncError(
  async (req, res, next) => {
    const { userId } = req.params;

    if (!userId) {
      return next(new ErrorHandler("User ID is required", 400));
    }

    // Get collection
    const SearchHistoryCollection = getCollection("searchhistory");

    // First, get the current document
    const userHistory = await SearchHistoryCollection.findOne({
      user: new ObjectId(req.user._id),
    });

    if (!userHistory) {
      return res.status(200).json({
        success: true,
        message: "Search history not found",
      });
    }

    // Filter out the user to be removed
    const updatedUsers = userHistory.searchedUsers.filter(
      (id) => id.toString() !== new ObjectId(userId).toString()
    );

    if (updatedUsers.length === 0) {
      // If no users are left, delete the entire document
      await SearchHistoryCollection.deleteOne({
        user: new ObjectId(req.user._id),
      });
    } else {
      // Otherwise, update with the filtered array
      await SearchHistoryCollection.updateOne(
        { user: new ObjectId(req.user._id) },
        { $set: { searchedUsers: updatedUsers } }
      );
    }

    res.status(200).json({
      success: true,
      message: "Removed from search history",
    });
  }
);

// Clear entire search history
export const clearSearchHistory = catchAsyncError(async (req, res, next) => {
  // Get collection
  const SearchHistoryCollection = getCollection("searchhistory");

  // Clear the searchedUsers array
  await SearchHistoryCollection.updateOne(
    { user: new ObjectId(req.user._id) },
    { $set: { searchedUsers: [] } }
  );

  res.status(200).json({
    success: true,
    message: "Search history cleared",
  });
});
