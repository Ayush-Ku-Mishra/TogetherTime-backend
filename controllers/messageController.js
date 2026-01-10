import { catchAsyncError } from "../middlewares/catchAsyncError.js";
import ErrorHandler from "../middlewares/error.js";
import { connection, getCollection } from "../database/db.js";
import { ObjectId } from "mongodb";

// Get all conversations for current user
export const getMyConversations = catchAsyncError(async (req, res, next) => {
  // Get conversations collection
  const ConversationCollection = getCollection("conversations");
  const UserCollection = getCollection("users");
  
  // Find all conversations where the current user is a participant
  const conversations = await ConversationCollection.find({
    participants: new ObjectId(req.user._id)
  }).toArray();
  
  // Get all participant IDs
  const participantIds = conversations.reduce((acc, conv) => {
    return [...acc, ...conv.participants];
  }, []);
  
  // Get unique participant IDs
  const uniqueParticipantIds = [...new Set(participantIds.map(id => id.toString()))];
  
  // Get all participant users
  const participants = await UserCollection.find({
    _id: { $in: uniqueParticipantIds.map(id => new ObjectId(id)) }
  }).toArray();
  
  // Format conversation data
  const formattedConversations = conversations.map(conv => {
    // Get other participants (not current user)
    const otherParticipants = conv.participants
      .filter(p => p.toString() !== req.user._id.toString())
      .map(p => {
        const user = participants.find(u => u._id.toString() === p.toString());
        return user ? {
          _id: user._id,
          name: user.name,
          username: user.username || user.email.split('@')[0],
          avatar: user.avatar || ""
        } : null;
      })
      .filter(Boolean);
    
    // For direct messages, use the other person's name as the title
    let title = conv.name || "";
    if (!conv.isGroup && otherParticipants.length > 0) {
      title = otherParticipants[0].name;
    }
    
    return {
      _id: conv._id,
      isGroup: conv.isGroup,
      title,
      participants: otherParticipants,
      latestMessage: conv.latestMessage || null,
      updatedAt: conv.updatedAt
    };
  });
  
  res.status(200).json({
    success: true,
    conversations: formattedConversations
  });
});

// Get messages for a specific conversation
export const getConversationMessages = catchAsyncError(async (req, res, next) => {
  const { conversationId } = req.params;
  
  // Ensure conversationId is valid
  if (!conversationId || !ObjectId.isValid(conversationId)) {
    return next(new ErrorHandler("Invalid conversation ID", 400));
  }
  
  // Get messages collection
  const MessageCollection = getCollection("messages");
  const ConversationCollection = getCollection("conversations");
  
  // Check if conversation exists and user is a participant
  const conversation = await ConversationCollection.findOne({
    _id: new ObjectId(conversationId),
    participants: new ObjectId(req.user._id)
  });
  
  if (!conversation) {
    return next(new ErrorHandler("Conversation not found or access denied", 404));
  }
  
  // Get messages for this conversation
  const messages = await MessageCollection.find({
    conversation: new ObjectId(conversationId)
  }).sort({ createdAt: 1 }).toArray();
  
  res.status(200).json({
    success: true,
    messages
  });
});

// Create a new message in a conversation
export const sendMessage = catchAsyncError(async (req, res, next) => {
  const { conversationId, content } = req.body;
  
  // Validate inputs
  if (!conversationId || !content) {
    return next(new ErrorHandler("Conversation ID and message content are required", 400));
  }
  
  // Get collections
  const MessageCollection = getCollection("messages");
  const ConversationCollection = getCollection("conversations");
  
  // Check if conversation exists and user is a participant
  const conversation = await ConversationCollection.findOne({
    _id: new ObjectId(conversationId),
    participants: new ObjectId(req.user._id)
  });
  
  if (!conversation) {
    return next(new ErrorHandler("Conversation not found or access denied", 404));
  }
  
  // Create a new message
  const newMessage = {
    sender: new ObjectId(req.user._id),
    content: content.trim(),
    conversation: new ObjectId(conversationId),
    readBy: [new ObjectId(req.user._id)], // Sender has read their own message
    createdAt: new Date(),
    updatedAt: new Date()
  };
  
  // Insert the message
  const result = await MessageCollection.insertOne(newMessage);
  
  // Update conversation with latest message
  await ConversationCollection.updateOne(
    { _id: new ObjectId(conversationId) },
    { 
      $set: { 
        latestMessage: result.insertedId,
        updatedAt: new Date()
      } 
    }
  );
  
  res.status(201).json({
    success: true,
    message: {
      _id: result.insertedId,
      ...newMessage
    }
  });
});

// Create a new conversation
export const createConversation = catchAsyncError(async (req, res, next) => {
  const { participantId, isGroup, name } = req.body;
  
  // For direct messages, we need one recipient
  if (!isGroup && !participantId) {
    return next(new ErrorHandler("Recipient is required for direct messages", 400));
  }
  
  // Get collections
  const ConversationCollection = getCollection("conversations");
  const UserCollection = getCollection("users");
  
  // For direct messages
  if (!isGroup) {
    // Check if participant exists
    const participant = await UserCollection.findOne({
      _id: new ObjectId(participantId)
    });
    
    if (!participant) {
      return next(new ErrorHandler("User not found", 404));
    }
    
    // Check if conversation already exists
    const existingConversation = await ConversationCollection.findOne({
      isGroup: false,
      participants: { 
        $all: [
          new ObjectId(req.user._id),
          new ObjectId(participantId)
        ],
        $size: 2
      }
    });
    
    if (existingConversation) {
      return res.status(200).json({
        success: true,
        conversation: {
          _id: existingConversation._id,
          isGroup: false,
          title: participant.name,
          participants: [{
            _id: participant._id,
            name: participant.name,
            username: participant.username || participant.email.split('@')[0],
            avatar: participant.avatar || ""
          }]
        }
      });
    }
    
    // Create a new conversation
    const newConversation = {
      participants: [
        new ObjectId(req.user._id),
        new ObjectId(participantId)
      ],
      isGroup: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const result = await ConversationCollection.insertOne(newConversation);
    
    res.status(201).json({
      success: true,
      conversation: {
        _id: result.insertedId,
        isGroup: false,
        title: participant.name,
        participants: [{
          _id: participant._id,
          name: participant.name,
          username: participant.username || participant.email.split('@')[0],
          avatar: participant.avatar || ""
        }]
      }
    });
  }
  // For group conversations (you can implement this later)
});

// Search users for creating new conversations
export const searchUsers = catchAsyncError(async (req, res, next) => {
  const { query } = req.query;
  
  if (!query || query.trim().length < 2) {
    return res.status(200).json({
      success: true,
      users: []
    });
  }
  
  // Get users collection
  const UserCollection = getCollection("users");
  
  // Search for users with name or username matching the query
  // During testing/development, include current user by removing the _id filter
  const users = await UserCollection.find({
    $or: [
      { name: { $regex: query, $options: 'i' } },
      { username: { $regex: query, $options: 'i' } },
      { email: { $regex: query, $options: 'i' } }
    ],
    // _id: { $ne: new ObjectId(req.user._id) }, // Comment out for testing
    accountVerified: true,
    status: { $ne: "suspended" }
  }).limit(10).toArray();
  
  // Format response
  const formattedUsers = users.map(user => ({
    _id: user._id,
    name: user.name,
    username: user.username || user.email.split('@')[0],
    avatar: user.avatar || "",
    email: user.email,
    isCurrentUser: user._id.toString() === req.user._id.toString()
  }));
  
  res.status(200).json({
    success: true,
    users: formattedUsers
  });
});