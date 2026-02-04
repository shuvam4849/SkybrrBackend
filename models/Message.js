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
  
  // ✅ UPDATED: Add 'post_share' to messageType enum
  messageType: {
    type: String,
    enum: ['text', 'image', 'video', 'audio', 'file', 'grouped_media', 'post_share'],
    default: 'text'
  },
  
  // ✅ FIXED: Single postShare schema with proper structure
  postShare: {
    postId: {
      type: String,
      required: function() { return this.messageType === 'post_share'; }
    },
    postContent: String,
    postImage: String,
    postVideo: String,
    postMedia: [{
      // Use Map or Mixed for flexibility
      type: Map,
      of: mongoose.Schema.Types.Mixed
    }],
    postAuthor: {
      id: {
        type: String, // ✅ Change from ObjectId to String to allow Firebase UIDs
        required: function() { return this.messageType === 'post_share'; }
      },
      name: String,
      avatar: String
    },
    sharedText: String, // Optional text added when sharing
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
  // ✅ FIXED: SINGLE media object (for backward compatibility)
 // To this (add [] to make it an array):
media: [{  // ✅ Add brackets to make it an array
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

  // ✅ FIXED: MEDIA_ARRAY for grouped media
  mediaArray: [{
  uri: String,
  url: String,
  originalUrl: String,
  fileUrl: String,
  thumbnailUrl: String,           // ← Must be 'url' not 'uri' or 'fileUrl'
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
    thumbnailUrl: String,
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
  
  // Update groupedMedia schema:
groupedMedia: [{
  // ✅ ADD all possible URL fields
  uri: String,           // For compatibility with frontend
  url: String,           // Original high-res URL
  originalUrl: String,   // Explicit original URL
  fileUrl: String,       // Alternative name for original
  thumbnailUrl: String,  // Thumbnail URL
  
  // Rest of fields...
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
  
  // ✅ ADDED: Generic metadata field for additional data
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
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
// ✅ ADDED: Index for post share queries
messageSchema.index({ 'postShare.postId': 1 });
messageSchema.index({ 'postShare.postAuthor.id': 1 });

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

// Helper method to check if message has media
messageSchema.methods.hasMedia = function() {
  return (this.media && this.media.fileUrl) || 
         (this.groupedMedia && this.groupedMedia.length > 0) ||
         (this.isPostShare() && this.postShare.postImage);
};

// Helper method to get media type
messageSchema.methods.getMediaType = function() {
  if (this.messageType === 'grouped_media') return 'grouped_media';
  if (this.messageType === 'post_share') return 'post_share';
  
  if (!this.media || !this.media.mimeType) return null;
  
  const mime = this.media.mimeType;
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
    originalPostUrl = ''
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
    }
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

// Virtual for getting all media URLs (including post share image)
messageSchema.virtual('allMediaUrls').get(function() {
  const urls = [];
  
  // Add single media URL if exists
  if (this.media && this.media.fileUrl) {
    urls.push({
      uri: this.media.fileUrl,
      type: this.getMediaType(),
      fileName: this.media.fileName,
      fileSize: this.media.fileSize,
      mimeType: this.media.mimeType,
      thumbnailUrl: this.media.thumbnailUrl,
      duration: this.media.duration,
      width: this.media.width,
      height: this.media.height
    });
  }
  
  // Add grouped media URLs
  if (this.groupedMedia && this.groupedMedia.length > 0) {
    this.groupedMedia.forEach(media => {
      urls.push({
        uri: media.uri,
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
  
  // Add post share image if exists
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

// Ensure virtual fields are included
messageSchema.set('toJSON', { virtuals: true });
messageSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Message', messageSchema);