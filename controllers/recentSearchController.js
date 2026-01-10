import { catchAsyncError } from "../middlewares/catchAsyncError.js";
import ErrorHandler from "../middlewares/error.js";
import { connection, getCollection } from "../database/db.js";
import { ObjectId } from "mongodb";

// Add a user to recent searches
export const addRecentSearch = catchAsyncError(async (req, res, next) => {
  const { searchedUserId } = req.body;

  if (!searchedUserId) {
    return next(new ErrorHandler("Searched user ID is required", 400));
  }

  // Get collections
  const RecentSearchCollection = getCollection("recentsearches");
  const UserCollection = getCollection("users");

  // Check if the searched user exists
  const searchedUser = await UserCollection.findOne({
    _id: new ObjectId(searchedUserId),
    accountVerified: true,
    status: { $ne: "suspended" },
  });

  if (!searchedUser) {
    return next(new ErrorHandler("User not found", 404));
  }

  // Find if current user already has a recent searches document
  const userRecentSearches = await RecentSearchCollection.findOne({
    user: new ObjectId(req.user._id),
  });

  if (userRecentSearches) {
    // User already has recent searches, update the array
    // First, remove this searchedUser if it exists (to avoid duplicates)
    // Then add it to the beginning (for recency)
    await RecentSearchCollection.updateOne(
      { user: new ObjectId(req.user._id) },
      {
        $pull: { searchedUsers: new ObjectId(searchedUserId) },
      }
    );

    // Now add to the beginning of the array with $push and $position
    await RecentSearchCollection.updateOne(
      { user: new ObjectId(req.user._id) },
      {
        $push: {
          searchedUsers: {
            $each: [new ObjectId(searchedUserId)],
            $position: 0,
          },
        },
        $set: { updatedAt: new Date() },
      }
    );
  } else {
    // Create new document with searchedUsers array
    await RecentSearchCollection.insertOne({
      user: new ObjectId(req.user._id),
      searchedUsers: [new ObjectId(searchedUserId)],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  res.status(200).json({
    success: true,
    message: "Recent search added",
  });
});

// Then update getRecentSearches to work with the new schema
export const getRecentSearches = catchAsyncError(async (req, res, next) => {
  // Get collections
  const RecentSearchCollection = getCollection("recentsearches");
  const UserCollection = getCollection("users");

  // Get recent searches document for user
  const userSearches = await RecentSearchCollection.findOne({
    user: new ObjectId(req.user._id),
  });

  if (
    !userSearches ||
    !userSearches.searchedUsers ||
    userSearches.searchedUsers.length === 0
  ) {
    return res.status(200).json({
      success: true,
      recentSearches: [],
    });
  }

  // Limit to 8 most recent
  const recentSearchIds = userSearches.searchedUsers.slice(0, 8);

  // Get user details for all searched users
  const users = await UserCollection.find({
    _id: { $in: recentSearchIds },
  }).toArray();

  // Format the response with user details (maintaining order from searchedUsers array)
  const formattedSearches = recentSearchIds
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
    recentSearches: formattedSearches,
  });
});

// Delete a user from recent searches
export const deleteRecentSearch = catchAsyncError(async (req, res, next) => {
  const { searchedUserId } = req.params;

  if (!searchedUserId) {
    return next(new ErrorHandler("Searched user ID is required", 400));
  }

  // Get collection
  const RecentSearchCollection = getCollection("recentsearches");

  // First, get the current document
  const userRecentSearches = await RecentSearchCollection.findOne({
    user: new ObjectId(req.user._id),
  });

  if (!userRecentSearches) {
    return res.status(200).json({
      success: true,
      message: "Recent searches not found",
    });
  }

  // Filter out the user to be removed
  const updatedSearches = userRecentSearches.searchedUsers.filter(
    (id) => id.toString() !== new ObjectId(searchedUserId).toString()
  );

  if (updatedSearches.length === 0) {
    // If no users are left, delete the entire document
    await RecentSearchCollection.deleteOne({
      user: new ObjectId(req.user._id),
    });
  } else {
    // Otherwise, update with the filtered array
    await RecentSearchCollection.updateOne(
      { user: new ObjectId(req.user._id) },
      { $set: { searchedUsers: updatedSearches } }
    );
  }

  res.status(200).json({
    success: true,
    message: "Recent search deleted",
  });
});

// Update clearRecentSearches
export const clearRecentSearches = catchAsyncError(async (req, res, next) => {
  // Get collection
  const RecentSearchCollection = getCollection("recentsearches");

  // Clear the searchedUsers array
  await RecentSearchCollection.updateOne(
    { user: new ObjectId(req.user._id) },
    { $set: { searchedUsers: [] } }
  );

  res.status(200).json({
    success: true,
    message: "All recent searches cleared",
  });
});
