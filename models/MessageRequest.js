const mongoose = require('mongoose');

const MessageRequestSchema = new mongoose.Schema({
  // Chat that was created for this request
  chat: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat',
    required: true
  },
  
  // User who sent the request (initiator)
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // User who received the request (receiver with private account)
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Status of the request
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'withdrawn'],
    default: 'pending'
  },
  
  // Initial message sent with request
  initialMessage: {
    type: String,
    default: "Hi there! I'd like to message you."
  },
  
  // Message type
  messageType: {
    type: String,
    enum: ['text', 'image', 'video', 'audio', 'file'],
    default: 'text'
  },
  
  // Media for the initial message (if any)
  media: {
    fileUrl: String,
    fileName: String,
    fileSize: Number,
    mimeType: String,
    thumbnailUrl: String,
    duration: Number, // for audio/video
    width: Number,   // for images/videos
    height: Number   // for images/videos
  },
  
  // Read status
  isRead: {
    type: Boolean,
    default: false
  },
  
  // Rejection reason (if rejected)
  rejectionReason: {
    type: String,
    enum: ['not_interested', 'spam', 'inappropriate', 'other'],
    default: 'not_interested'
  },
  
  // Custom rejection message
  customRejectionMessage: String,
  
  // Expiration date (auto-reject after 30 days)
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for faster queries
MessageRequestSchema.index({ sender: 1, receiver: 1, status: 1 });
MessageRequestSchema.index({ receiver: 1, status: 1, createdAt: -1 });
MessageRequestSchema.index({ chat: 1 }, { unique: true });
MessageRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Methods
MessageRequestSchema.methods.accept = async function() {
  this.status = 'accepted';
  this.updatedAt = Date.now();
  await this.save();
  
  // Update chat status
  const Chat = require('./Chat');
  await Chat.findByIdAndUpdate(this.chat, {
    isPendingRequest: false,
    isActiveChat: true,
    updatedAt: Date.now()
  });
  
  return this;
};

MessageRequestSchema.methods.reject = async function(reason = 'not_interested', customMessage = null) {
  this.status = 'rejected';
  this.rejectionReason = reason;
  if (customMessage) this.customRejectionMessage = customMessage;
  this.updatedAt = Date.now();
  await this.save();
  
  // Archive or delete the chat
  const Chat = require('./Chat');
  await Chat.findByIdAndUpdate(this.chat, {
    isArchived: true,
    updatedAt: Date.now()
  });
  
  return this;
};

MessageRequestSchema.methods.withdraw = async function() {
  this.status = 'withdrawn';
  this.updatedAt = Date.now();
  await this.save();
  
  // Delete the chat
  const Chat = require('./Chat');
  await Chat.findByIdAndDelete(this.chat);
  
  return this;
};

MessageRequestSchema.methods.markAsRead = async function() {
  this.isRead = true;
  await this.save();
  return this;
};

// Static methods
MessageRequestSchema.statics.findPendingRequests = function(receiverId) {
  return this.find({
    receiver: receiverId,
    status: 'pending'
  })
  .populate('sender', 'name email profilePicture firebaseUid')
  .populate('chat')
  .populate('receiver', 'name email')
  .sort({ createdAt: -1 });
};

MessageRequestSchema.statics.findSentRequests = function(senderId) {
  return this.find({
    sender: senderId,
    status: 'pending'
  })
  .populate('receiver', 'name email profilePicture firebaseUid')
  .populate('chat')
  .sort({ createdAt: -1 });
};

MessageRequestSchema.statics.findRequestByChat = function(chatId) {
  return this.findOne({ chat: chatId })
    .populate('sender', 'name email profilePicture firebaseUid')
    .populate('receiver', 'name email profilePicture firebaseUid')
    .populate('chat');
};

MessageRequestSchema.statics.findByUsers = function(senderId, receiverId) {
  return this.findOne({
    sender: senderId,
    receiver: receiverId,
    status: 'pending'
  });
};

MessageRequestSchema.statics.getRequestCounts = async function(userId) {
  const pendingCount = await this.countDocuments({
    receiver: userId,
    status: 'pending',
    isRead: false
  });
  
  const sentCount = await this.countDocuments({
    sender: userId,
    status: 'pending'
  });
  
  return { pendingCount, sentCount };
};

const MessageRequest = mongoose.model('MessageRequest', MessageRequestSchema);

module.exports = MessageRequest;