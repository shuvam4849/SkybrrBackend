const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    trim: true
  },
  chat: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat',
    required: true
  },
  status: {
    type: String,
    enum: ['sending', 'sent', 'delivered', 'read', 'failed', 'offline'],
    default: 'sent'
  },
  readBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],

  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
    default: null
  },
  replyMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
    default: null
  },
  replyContent: String,
  replySender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  replyMessageType: {
    type: String,
    enum: ['text', 'image', 'video', 'audio', 'file', 'grouped_media', 'post_share']
  },
  
  messageType: {
    type: String,
    enum: ['text', 'image', 'video', 'audio', 'file', 'grouped_media', 'post_share'],
    default: 'text'
  },
  
  // ✅ FIXED: Single postShare schema
  postShare: {
    postId: {
      type: String,
      required: function() { return this.messageType === 'post_share'; }
    },
    postContent: String,
    postImage: String,
    postVideo: String,
    postMedia: [{
      type: Map,
      of: mongoose.Schema.Types.Mixed
    }],
    postAuthor: {
      id: {
        type: String,
        required: function() { return this.messageType === 'post_share'; }
      },
      name: String,
      avatar: String
    },
    sharedText: String,
    originalPostUrl: String,
    timestamp: {
      type: Date,
      default: Date.now
    }
  },
  
  fileUrl: {
    type: String
  },
  fileName: {
    type: String
  },
  
  // Media array for single media items
  media: [{
    url: String,
    thumbnailUrl: String,
    mimeType: String,
    fileName: String,
    fileSize: Number,
    duration: Number,
    width: Number,
    height: Number,
    uploadId: String,
    uploadedAt: Date
  }],

  // Media array for grouped media
  mediaArray: [{
    uri: String,
    url: String,
    originalUrl: String,
    fileUrl: String,
    thumbnailUrl: String,
    type: {
      type: String,
      enum: ['image', 'video', 'audio', 'file'],
      required: true
    },
    fileName: String,
    fileSize: Number,
    mimeType: {
      type: String,
      default: 'application/octet-stream'
    },
    duration: Number,
    width: Number,
    height: Number,
    caption: String,
    order: Number,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Grouped media
  groupedMedia: [{
    uri: String,
    url: String,
    originalUrl: String,
    fileUrl: String,
    thumbnailUrl: String,
    type: {
      type: String,
      enum: ['image', 'video', 'audio', 'file'],
      required: true
    },
    fileName: String,
    fileSize: Number,
    mimeType: {
      type: String,
      default: 'application/octet-stream'
    },
    duration: Number,
    width: Number,
    height: Number,
    caption: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // ✅ FIXED: Change from Map to Mixed for better compatibility
  metadata: {
    type: mongoose.Schema.Types.Mixed,  // ← CHANGED FROM Map TO Mixed
    default: {}
  },
  
  // ✅ ADDED: Optimistic ID tracking (for matching)
  optimisticId: {
    type: String,
    index: true
  },
  
  // ✅ ADDED: Upload tracking fields
  uploadId: {
    type: String,
    index: true
  },
  
  batchId: {
    type: String,
    index: true
  },
  
  // ✅ ADDED: Track if this is a server confirmation of optimistic message
  isServerConfirmation: {
    type: Boolean,
    default: false
  }
  
}, {
  timestamps: true
});

// Create indexes
messageSchema.index({ chat: 1, createdAt: -1 });
messageSchema.index({ sender: 1 });
messageSchema.index({ status: 1 });
messageSchema.index({ 'media.uploadId': 1 });
messageSchema.index({ 'groupedMedia.uri': 1 });
messageSchema.index({ 'postShare.postId': 1 });
messageSchema.index({ 'postShare.postAuthor.id': 1 });
// ✅ ADDED: Indexes for optimistic tracking
messageSchema.index({ optimisticId: 1 });
messageSchema.index({ uploadId: 1 });
messageSchema.index({ batchId: 1 });

// Helper method to check if message is a post share
messageSchema.methods.isPostShare = function() {
  return this.messageType === 'post_share';
};

// Helper method to get post share data
messageSchema.methods.getPostShareData = function() {
  if (!this.isPostShare()) return null;
  
  return {
    id: this.postShare.postId,
    content: this.postShare.postContent || this.content,
    image: this.postShare.postImage,
    video: this.postShare.postVideo,
    media: this.postShare.postMedia,
    author: this.postShare.postAuthor,
    sharedText: this.postShare.sharedText,
    timestamp: this.postShare.timestamp,
    originalPostUrl: this.postShare.originalPostUrl,
    shareTimestamp: this.createdAt
  };
};

// ✅ NEW: Helper method to check if message has metadata
messageSchema.methods.hasMetadata = function() {
  return this.metadata && Object.keys(this.metadata).length > 0;
};

// ✅ NEW: Helper method to get upload ID from metadata
messageSchema.methods.getUploadId = function() {
  return this.uploadId || (this.metadata && this.metadata.uploadId);
};

// ✅ NEW: Helper method to get optimistic ID from metadata
messageSchema.methods.getOptimisticId = function() {
  return this.optimisticId || (this.metadata && this.metadata.tempMessageId);
};

// ✅ NEW: Helper method to check if this message matches an optimistic message
messageSchema.methods.matchesOptimistic = function(optimisticId, uploadId) {
  // Check direct optimistic ID match
  if (this.optimisticId === optimisticId) return true;
  
  // Check upload ID match
  if (uploadId && this.getUploadId() === uploadId) return true;
  
  // Check metadata match
  if (this.metadata) {
    if (this.metadata.tempMessageId === optimisticId) return true;
    if (this.metadata.uploadId === uploadId) return true;
  }
  
  return false;
};

// Helper method to check if message has media
messageSchema.methods.hasMedia = function() {
  return (this.media && this.media.length > 0) || 
         (this.groupedMedia && this.groupedMedia.length > 0) ||
         (this.isPostShare() && this.postShare.postImage);
};

// Helper method to get media type
messageSchema.methods.getMediaType = function() {
  if (this.messageType === 'grouped_media') return 'grouped_media';
  if (this.messageType === 'post_share') return 'post_share';
  
  if (!this.media || this.media.length === 0) return null;
  
  const firstMedia = this.media[0];
  if (!firstMedia.mimeType) return null;
  
  const mime = firstMedia.mimeType;
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
};

// Helper method to check if message has grouped media
messageSchema.methods.hasGroupedMedia = function() {
  return this.messageType === 'grouped_media' && 
         this.groupedMedia && 
         this.groupedMedia.length > 0;
};

// ✅ NEW: Static method to find message by optimistic ID
messageSchema.statics.findByOptimisticId = function(optimisticId) {
  return this.findOne({
    $or: [
      { optimisticId: optimisticId },
      { 'metadata.tempMessageId': optimisticId }
    ]
  });
};

// ✅ NEW: Static method to find message by upload ID
messageSchema.statics.findByUploadId = function(uploadId) {
  return this.findOne({
    $or: [
      { uploadId: uploadId },
      { 'metadata.uploadId': uploadId }
    ]
  });
};

// ✅ NEW: Static method to create a message with optimistic tracking
messageSchema.statics.createWithOptimisticTracking = async function(data) {
  const {
    optimisticId,
    uploadId,
    batchId,
    metadata,
    ...messageData
  } = data;
  
  // Create message with tracking fields
  const message = new this({
    ...messageData,
    optimisticId: optimisticId,
    uploadId: uploadId,
    batchId: batchId,
    metadata: {
      ...metadata,
      tempMessageId: optimisticId,
      uploadId: uploadId,
      batchId: batchId,
      isOptimistic: !!optimisticId
    }
  });
  
  return message.save();
};

// Static method to find post share messages
messageSchema.statics.findPostShares = function(chatId) {
  return this.find({
    chat: chatId,
    messageType: 'post_share'
  }).sort({ createdAt: -1 });
};

// Static method to find messages shared by specific user
messageSchema.statics.findUserPostShares = function(userId, chatId = null) {
  const query = {
    sender: userId,
    messageType: 'post_share'
  };
  
  if (chatId) {
    query.chat = chatId;
  }
  
  return this.find(query).sort({ createdAt: -1 });
};

// Static method to create a post share message
messageSchema.statics.createPostShare = async function(data) {
  const {
    sender,
    chat,
    content = "Shared a post",
    postId,
    postContent,
    postImage,
    postVideo,
    postMedia = [],
    postAuthor,
    sharedText = '',
    originalPostUrl = '',
    metadata = {}
  } = data;
  
  if (!sender || !chat || !postId) {
    throw new Error('Missing required fields for post share');
  }
  
  const postShareMessage = new this({
    sender,
    chat,
    content: sharedText || content,
    messageType: 'post_share',
    postShare: {
      postId,
      postContent,
      postImage,
      postVideo,
      postMedia,
      postAuthor,
      sharedText,
      originalPostUrl,
      timestamp: new Date()
    },
    metadata: metadata // ✅ Include metadata
  });
  
  return postShareMessage.save();
};

// Status-related helper methods
messageSchema.methods.markAsDelivered = function() {
  this.status = 'delivered';
  return this.save();
};

messageSchema.methods.markAsRead = function(userId) {
  if (!this.readBy.includes(userId)) {
    this.readBy.push(userId);
  }
  this.status = 'read';
  return this.save();
};

// Virtual for formatted status
messageSchema.virtual('formattedStatus').get(function() {
  switch (this.status) {
    case 'sending': return '⏳';
    case 'sent': return '✓';
    case 'delivered': return '✓✓';
    case 'read': return '✓✓🔵';
    case 'failed': return '❌';
    case 'offline': return '📴';
    default: return '✓✓';
  }
});

// Virtual for getting all media URLs
messageSchema.virtual('allMediaUrls').get(function() {
  const urls = [];
  
  // Add single media URLs
  if (this.media && this.media.length > 0) {
    this.media.forEach(media => {
      urls.push({
        uri: media.url,
        type: this.getMediaType(),
        fileName: media.fileName,
        fileSize: media.fileSize,
        mimeType: media.mimeType,
        thumbnailUrl: media.thumbnailUrl,
        duration: media.duration,
        width: media.width,
        height: media.height,
        uploadId: media.uploadId
      });
    });
  }
  
  // Add grouped media URLs
  if (this.groupedMedia && this.groupedMedia.length > 0) {
    this.groupedMedia.forEach(media => {
      urls.push({
        uri: media.uri || media.fileUrl || media.url,
        type: media.type,
        fileName: media.fileName,
        fileSize: media.fileSize,
        mimeType: media.mimeType,
        thumbnailUrl: media.thumbnailUrl,
        duration: media.duration,
        width: media.width,
        height: media.height,
        caption: media.caption
      });
    });
  }
  
  // Add post share image
  if (this.isPostShare() && this.postShare.postImage) {
    urls.push({
      uri: this.postShare.postImage,
      type: 'image',
      fileName: 'post_image.jpg',
      isPostShare: true,
      postId: this.postShare.postId
    });
  }
  
  return urls;
});

// Virtual for checking if message is from optimistic upload
messageSchema.virtual('isFromOptimisticUpload').get(function() {
  return !!this.optimisticId || 
         !!this.uploadId || 
         (this.metadata && this.metadata.isOptimistic);
});

// Ensure virtual fields are included
messageSchema.set('toJSON', { 
  virtuals: true,
  transform: function(doc, ret) {
    // Ensure metadata is always an object, not a Map
    if (ret.metadata && ret.metadata instanceof Map) {
      ret.metadata = Object.fromEntries(ret.metadata);
    }
    return ret;
  }
});

messageSchema.set('toObject', { 
  virtuals: true,
  transform: function(doc, ret) {
    if (ret.metadata && ret.metadata instanceof Map) {
      ret.metadata = Object.fromEntries(ret.metadata);
    }
    return ret;
  }
});

module.exports = mongoose.model('Message', messageSchema);