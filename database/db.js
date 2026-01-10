import mongoose from "mongoose";

export const connection = async () => {
  try {
    const isProd = process.env.NODE_ENV === "production";

    const MONGO_URI = isProd
      ? process.env.MONGO_URI_PROD
      : process.env.MONGO_URI_LOCAL;

    if (!MONGO_URI) {
      throw new Error("MongoDB URI not defined in environment variables");
    }

    await mongoose.connect(MONGO_URI, {
      dbName: process.env.DB_NAME,
    });

    console.log(
      `✅ MongoDB Connected (${isProd ? "ATLAS / PROD" : "LOCAL / COMPASS"})`
    );
    
    return mongoose.connection;
  } catch (err) {
    console.error("❌ MongoDB Connection Failed:", err.message);
    throw err;
  }
};

// Helper to get a collection (for direct MongoDB access)
export const getCollection = (collectionName) => {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('Database not connected. Call connection() first.');
  }
  return mongoose.connection.collection(collectionName);
};