// routes/messageRoutes.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose'); 
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const User = require('../models/User');
const { firebaseProtect } = require('../middleware/firebaseAuth');

// @desc    Get messages for a chat
// @route   GET /api/messages/:chatId
// @access  Private
router.get('/:chatId', firebaseProtect, async (req, res) => {
  try {
    const { chatId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || null;

    console.log(`📨 Fetching messages for chat ${chatId}`);

    // Check if chat exists
    const chat = await Chat.findById(chatId);
    if (!chat) {
      console.log(`❌ Chat not found: ${chatId}`);
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }

    // Verify user is a participant in the chat
    const isParticipant = chat.users.some(userId => 
      userId.toString() === req.user._id.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this chat'
      });
    }

    // Build query with reply data population
    let query = Message.find({ chat: chatId })
      .populate('sender', 'name profilePicture firebaseUid')
      .populate('replySender', 'name profilePicture firebaseUid')
      .populate({
        path: 'replyMessage',
        select: 'content messageType fileUrl groupedMedia sender createdAt status',
        populate: {
          path: 'sender',
          select: 'name profilePicture firebaseUid'
        }
      })
      .sort({ createdAt: -1 });

    // Only apply pagination if limit is provided
    if (limit && limit > 0) {
      const skip = (page - 1) * limit;
      query = query.skip(skip).limit(limit);
    }

    const messages = await query.lean();

    // Enhanced messages with all data
    const enhancedMessages = messages.map(message => ({
      ...message,
      groupedMedia: message.groupedMedia || [],
      // Ensure reply data is properly structured
      ...(message.replyTo && {
        replyTo: message.replyTo,
        replyMessage: message.replyMessage || {
          _id: message.replyTo,
          content: message.replyContent || '',
          messageType: message.replyMessageType || 'text',
          sender: message.replySender
        },
        replyContent: message.replyContent,
        replySender: message.replySender,
        replyMessageType: message.replyMessageType
      }),
      // Ensure postShare data is included
      ...(message.messageType === 'post_share' && {
        postShare: message.postShare || {}
      })
    }));

    // Reverse to get chronological order
    const chronologicalMessages = enhancedMessages.reverse();

    // Get total count
    const totalMessages = await Message.countDocuments({ chat: chatId });

    console.log(`✅ Found ${chronologicalMessages.length} messages for chat ${chatId}`);

    res.json({
      success: true,
      data: chronologicalMessages,
      pagination: {
        currentPage: page,
        totalPages: limit ? Math.ceil(totalMessages / limit) : 1,
        totalMessages,
        hasNextPage: limit ? page < Math.ceil(totalMessages / limit) : false,
        hasPrevPage: page > 1
      }
    });

  } catch (error) {
    console.error('❌ Get messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching messages',
      error: error.message
    });
  }
});

// @desc    Send a message (text, media, or reply)
// @route   POST /api/messages
// @access  Private
router.post('/', firebaseProtect, async (req, res) => {
  try {
    const { 
      chatId, 
      content, 
      messageType = 'text', 
      groupedMedia = [],
      replyTo,
      replyMessage,
      replyContent,
      replySender,
      replyMessageType
    } = req.body;

    console.log('📤 Sending message:', { 
      chatId, 
      content, 
      messageType,
      hasReply: !!replyTo,
      replyTo
    });

    if (!chatId || !content) {
      return res.status(400).json({
        success: false,
        message: 'Chat ID and content are required'
      });
    }

    // Check if chat exists
    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }

    // Verify user is a participant in the chat
    const isParticipant = chat.users.some(userId => 
      userId.toString() === req.user._id.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this chat'
      });
    }

   // In POST /api/messages route, update the processing:
let processedGroupedMedia = [];
if (groupedMedia && Array.isArray(groupedMedia)) {
  processedGroupedMedia = groupedMedia.map(media => {
    // Extract URLs with priority
    const originalUrl = media.originalUrl || media.url || media.fileUrl || media.uri;
    const thumbnailUrl = media.thumbnailUrl || media.thumbUrl;
    
    return {
      // ✅ Store ALL URL fields
      uri: originalUrl,
      url: originalUrl,
      originalUrl: originalUrl,
      fileUrl: originalUrl,
      thumbnailUrl: thumbnailUrl,
      
      type: media.type || media.messageType || 'image',
      fileName: media.fileName || media.name || 'file',
      fileSize: media.fileSize || 0,
      mimeType: media.mimeType || 'application/octet-stream',
      duration: media.duration || 0,
      width: media.width || 0,
      height: media.height || 0,
      caption: media.caption || '',
      
      // Store original data for debugging
      _original: {
        hasOriginalUrl: !!media.originalUrl,
        hasThumbnailUrl: !!media.thumbnailUrl,
        urlsMatch: originalUrl === thumbnailUrl
      }
    };
  });
  
  console.log('✅ Processed grouped media URLs:', {
    count: processedGroupedMedia.length,
    firstItem: {
      originalUrl: processedGroupedMedia[0]?.originalUrl?.substring(0, 50),
      thumbnailUrl: processedGroupedMedia[0]?.thumbnailUrl?.substring(0, 50),
      hasBoth: processedGroupedMedia[0]?.originalUrl && processedGroupedMedia[0]?.thumbnailUrl,
      isThumbnail: processedGroupedMedia[0]?.thumbnailUrl?.includes('/thumbnails/')
    }
  });
}

    // Build message data
    const messageData = {
      sender: req.user._id,
      content,
      chat: chatId,
      messageType,
      status: 'sent',
    };

    // Add grouped media if exists
    if (processedGroupedMedia.length > 0) {
      messageData.fileUrl = processedGroupedMedia[0]?.uri || null;
      messageData.groupedMedia = processedGroupedMedia;
    }

    // Add reply data if provided
    if (replyTo) {
      console.log(`🔗 This is a reply to message: ${replyTo}`);
      
      const repliedMessage = await Message.findById(replyTo);
      
      if (repliedMessage) {
        messageData.replyTo = repliedMessage._id;
        messageData.replyMessage = repliedMessage._id;
        messageData.replyContent = replyContent || repliedMessage.content || '';
        messageData.replySender = repliedMessage.sender;
        messageData.replyMessageType = repliedMessage.messageType || 'text';
      } else {
        messageData.replyTo = replyTo;
        messageData.replyContent = replyContent || '';
        messageData.replySender = replySender || null;
        messageData.replyMessageType = replyMessageType || 'text';
      }
    }

    // Create the message
    const message = await Message.create(messageData);

    // Populate sender and reply data
    await message.populate('sender', 'name profilePicture firebaseUid');
    await message.populate('replySender', 'name profilePicture firebaseUid');
    if (message.replyMessage) {
      await message.populate({
        path: 'replyMessage',
        select: 'content messageType fileUrl groupedMedia sender createdAt status',
        populate: {
          path: 'sender',
          select: 'name profilePicture firebaseUid'
        }
      });
    }

    // Update chat's latest message
    chat.latestMessage = message._id;
    await chat.save();

    console.log('✅ Message sent successfully:', message._id);

    // Emit socket event
    const io = req.app.get('io');
    // Emit socket event - FIXED VERSION
if (io) {
  const socketMessage = {
    _id: message._id,
    content: message.content,
    sender: {
      _id: message.sender._id,
      firebaseUid: message.sender.firebaseUid,
      name: message.sender.name,
      profilePicture: message.sender.profilePicture
    },
    chat: message.chat,
    messageType: message.messageType,
    
    // ✅ CRITICAL: Include both URLs
    fileUrl: message.fileUrl,  // Original high-res
    
    groupedMedia: message.groupedMedia?.map(item => ({
    // Send ALL URL formats
    uri: item.uri || item.url,
    url: item.url || item.uri,
    originalUrl: item.originalUrl || item.url || item.uri,
    fileUrl: item.fileUrl || item.url || item.uri,
    thumbnailUrl: item.thumbnailUrl,
    
    type: item.type,
    fileName: item.fileName,
    fileSize: item.fileSize,
    mimeType: item.mimeType,
    caption: item.caption,
    width: item.width,
    height: item.height,
    duration: item.duration
  })) || [],
  
  // Also include as media array
  media: message.groupedMedia?.map(item => ({
    uri: item.uri || item.url,
    url: item.url || item.uri,
    originalUrl: item.originalUrl || item.url || item.uri,
    thumbnailUrl: item.thumbnailUrl,
    type: item.type,
    fileName: item.fileName,
    fileSize: item.fileSize,
    mimeType: item.mimeType
  })) || []
};
  
  console.log('📡 Emitting message with URLs:', {
    hasGroupedMedia: socketMessage.groupedMedia?.length > 0,
    firstItem: {
      url: socketMessage.groupedMedia?.[0]?.url?.substring(0, 50),
      thumbnailUrl: socketMessage.groupedMedia?.[0]?.thumbnailUrl?.substring(0, 50),
      hasBoth: socketMessage.groupedMedia?.[0]?.url && socketMessage.groupedMedia?.[0]?.thumbnailUrl,
      different: socketMessage.groupedMedia?.[0]?.url !== socketMessage.groupedMedia?.[0]?.thumbnailUrl
    }
  });
  
  io.to(chatId).emit('message received', socketMessage);
}

    res.status(201).json({
      success: true,
      data: message,
      message: 'Message sent successfully'
    });

  } catch (error) {
    console.error('❌ Send message error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while sending message',
      error: error.message
    });
  }
});

// @desc    Share a post to a chat
// @route   POST /api/messages/share-post
// @access  Private
// In messageRoutes.js - Update the post share route to match the new schema

router.post('/share-post', firebaseProtect, async (req, res) => {
  try {
    const { chatId, content, postData } = req.body;
    
    console.log('📤 Share post request - FULL DATA:', {
  chatId,
  content: content || 'No share text',
  postData: {
    id: postData?.id,
    content: postData?.content || postData?.text || 'No content',
    authorId: postData?.authorId,
    authorName: postData?.authorName || 'Unknown',
    hasMedia: postData?.media?.length > 0 || !!postData?.image || !!postData?.video,
    mediaCount: postData?.media?.length || 0,
    image: postData?.image ? '✓' : '✗',
    video: postData?.video ? '✓' : '✗',
    mediaTypes: postData?.media?.map(m => m?.type) || [],
    timestamp: postData?.timestamp || 'Not provided'
  }
});

    // Validate chat ID
    if (!mongoose.Types.ObjectId.isValid(chatId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid chat ID format'
      });
    }

    // Check if chat exists
    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }

    // Verify user is a participant
    const isParticipant = chat.users.some(userId => 
      userId.toString() === req.user._id.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this chat'
      });
    }

    // ✅ FIX: Process postMedia - handle string or array
    let postMedia = [];
    if (postData.media) {
      try {
        if (typeof postData.media === 'string') {
          // Try to parse JSON string
          const parsed = JSON.parse(postData.media);
          postMedia = Array.isArray(parsed) ? parsed : [parsed];
        } else if (Array.isArray(postData.media)) {
          postMedia = postData.media;
        } else if (typeof postData.media === 'object') {
          postMedia = [postData.media];
        }
      } catch (error) {
        console.error('Error parsing postMedia:', error);
        postMedia = [];
      }
    }

    // ✅ FIX: Convert postMedia items to Map format if needed
    const formattedPostMedia = postMedia.map(item => {
      if (item && typeof item === 'object') {
        return new Map(Object.entries(item));
      }
      return item;
    });

    // ✅ FIX: Handle postAuthor.id - it can be Firebase UID (string)
    // Don't try to convert to ObjectId, just use as string
    const postAuthorId = postData.authorId || '';
    
    // Create message data
    const messageData = {
      sender: req.user._id,
      chat: chatId,
      content: content || "Shared a post",
      messageType: 'post_share',
      status: 'sent',
      postShare: {
        postId: postData.id || postData._id || '',
        postContent: postData.content || postData.text || '',
        postImage: postData.image || postData.imageUrl || '',
        postVideo: postData.video || postData.videoUrl || '',
        postMedia: formattedPostMedia,
        postAuthor: {
          id: postAuthorId, // ✅ Now accepts string (Firebase UID)
          name: postData.authorName || 'User',
          avatar: postData.authorAvatar || ''
        },
        sharedText: content || '',
        originalPostUrl: postData.url || `post/${postData.id}`,
        timestamp: new Date() // ✅ Always use current time to avoid issues
      }
    };

    console.log('📝 Creating post share message DETAILED:', {
  chatId,
  postId: messageData.postShare.postId,
  postContent: messageData.postShare.postContent?.substring(0, 50) + '...',
  postAuthor: {
    id: messageData.postShare.postAuthor.id,
    name: messageData.postShare.postAuthor.name,
    hasAvatar: !!messageData.postShare.postAuthor.avatar
  },
  media: {
    image: messageData.postShare.postImage ? '✓' : '✗',
    video: messageData.postShare.postVideo ? '✓' : '✗',
    mediaCount: messageData.postShare.postMedia?.length || 0
  },
  sharedText: messageData.content?.substring(0, 30) + '...'
});

    // Create the message
    const message = await Message.create(messageData);
    
    // Populate sender
    await message.populate('sender', 'name profilePicture email firebaseUid');
    
    // Update chat
    chat.latestMessage = message._id;
    await chat.save();

    console.log('✅ Post share created:', message._id);

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
  // ✅ FORMAT THE MESSAGE FOR FRONTEND
  const socketMessage = {
    _id: message._id,
    chat: message.chat,
    content: message.content,
    sender: {
      _id: message.sender._id,
      firebaseUid: message.sender.firebaseUid,
      name: message.sender.name,
      profilePicture: message.sender.profilePicture
    },
    messageType: 'post_share',
    type: 'post',
    isPost: true,
    // ✅ INCLUDE POST DATA FOR FRONTEND DISPLAY
    id: message.postShare?.postId || '',
    postId: message.postShare?.postId || '',
    content: message.postShare?.postContent || '',
    text: message.postShare?.postContent || '',
    caption: message.postShare?.postContent || '',
    // Media fields
    media: message.postShare?.postMedia || [],
    image: message.postShare?.postImage || '',
    imageUrl: message.postShare?.postImage || '',
    video: message.postShare?.postVideo || '',
    // Author info
    authorId: message.postShare?.postAuthor?.id || '',
    authorName: message.postShare?.postAuthor?.name || '',
    authorAvatar: message.postShare?.postAuthor?.avatar || '',
    // Share info
    shareText: message.content || message.postShare?.sharedText || 'Check this out!',
    sharedBy: message.sender.name,
    timestamp: message.postShare?.timestamp || message.createdAt,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    status: 'sent'
  };

  console.log('📡 Emitting post share via socket:', {
    messageId: socketMessage._id,
    isPost: socketMessage.isPost,
    hasMedia: socketMessage.media?.length > 0,
    hasImage: !!socketMessage.image
  });

  io.to(chatId.toString()).emit('message received', socketMessage);
  
  // Also emit for backward compatibility
  io.to(chatId.toString()).emit('new_message', socketMessage);
  io.to(chatId.toString()).emit('message', socketMessage);
}

    res.status(201).json({
      success: true,
      message: 'Post shared successfully',
      data: message
    });

  } catch (error) {
    console.error('❌ Share post error:', error);
    
    if (error.name === 'ValidationError') {
      const errorDetails = {};
      Object.keys(error.errors).forEach(key => {
        errorDetails[key] = {
          message: error.errors[key].message,
          value: error.errors[key].value,
          kind: error.errors[key].kind
        };
      });
      
      console.error('❌ Validation errors:', errorDetails);
      
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errorDetails
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to share post',
      error: error.message
    });
  }
});

// @desc    Get messages with grouped media
// @route   GET /api/messages/:chatId/grouped-media
// @access  Private
router.get('/:chatId/grouped-media', firebaseProtect, async (req, res) => {
  try {
    const { chatId } = req.params;

    console.log(`🖼️ Fetching grouped media messages for chat ${chatId}`);

    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }

    const isParticipant = chat.users.some(userId => 
      userId.toString() === req.user._id.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this chat'
      });
    }

    // Find grouped media messages
    const groupedMediaMessages = await Message.findGroupedMediaMessages(chatId);
    
    // Format response
    const formattedMessages = groupedMediaMessages.map(message => ({
      _id: message._id,
      content: message.content,
      sender: message.sender,
      chat: message.chat,
      messageType: message.messageType,
      status: message.status,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      groupedMedia: message.groupedMedia || [],
      groupedMediaCount: message.groupedMedia?.length || 0
    }));

    console.log(`✅ Found ${formattedMessages.length} grouped media messages for chat ${chatId}`);

    res.json({
      success: true,
      data: formattedMessages,
      count: formattedMessages.length
    });

  } catch (error) {
    console.error('❌ Get grouped media messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching grouped media messages',
      error: error.message
    });
  }
});

// @desc    Mark message as delivered
// @route   PUT /api/messages/:messageId/delivered
// @access  Private
router.put('/:messageId/delivered', firebaseProtect, async (req, res) => {
  try {
    const { messageId } = req.params;

    console.log('📬 Marking message as delivered:', messageId);

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    await message.markAsDelivered();

    console.log('✅ Message marked as delivered:', messageId);

    const io = req.app.get('io');
    if (io) {
      io.to(message.chat.toString()).emit('message delivered', {
        messageId: message._id,
        chatId: message.chat,
        status: 'delivered'
      });
    }

    res.json({
      success: true,
      data: message,
      message: 'Message marked as delivered'
    });

  } catch (error) {
    console.error('❌ Mark as delivered error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while marking message as delivered',
      error: error.message
    });
  }
});

// @desc    Mark message as read
// @route   PUT /api/messages/:messageId/read
// @access  Private
router.put('/:messageId/read', firebaseProtect, async (req, res) => {
  try {
    const { messageId } = req.params;

    console.log('📖 Marking message as read:', messageId);

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    await message.markAsRead(req.user._id);

    console.log('✅ Message marked as read:', messageId);

    const io = req.app.get('io');
    if (io) {
      io.to(message.chat.toString()).emit('message read', {
        messageId: message._id,
        chatId: message.chat,
        readBy: req.user._id,
        status: 'read'
      });
    }

    res.json({
      success: true,
      data: message,
      message: 'Message marked as read'
    });

  } catch (error) {
    console.error('❌ Mark as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while marking message as read',
      error: error.message
    });
  }
});

// @desc    Mark multiple messages as read
// @route   PUT /api/messages/read-multiple
// @access  Private
router.put('/read-multiple', firebaseProtect, async (req, res) => {
  try {
    const { messageIds } = req.body;

    console.log('📖 Marking multiple messages as read:', messageIds);

    if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Message IDs array is required'
      });
    }

    const updatePromises = messageIds.map(async (messageId) => {
      const message = await Message.findById(messageId);
      if (message) {
        return message.markAsRead(req.user._id);
      }
    });

    await Promise.all(updatePromises);

    console.log(`✅ ${messageIds.length} messages marked as read`);

    res.json({
      success: true,
      message: `${messageIds.length} messages marked as read`
    });

  } catch (error) {
    console.error('❌ Mark multiple as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while marking messages as read',
      error: error.message
    });
  }
});

// @desc    Delete a message
// @route   DELETE /api/messages/:messageId
// @access  Private
router.delete('/:messageId', firebaseProtect, async (req, res) => {
  try {
    const { messageId } = req.params;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    if (message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own messages'
      });
    }

    await Message.findByIdAndDelete(messageId);

    console.log('✅ Message deleted:', messageId);

    res.json({
      success: true,
      message: 'Message deleted successfully'
    });

  } catch (error) {
    console.error('❌ Delete message error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting message',
      error: error.message
    });
  }
});

// @desc    Search messages in a chat
// @route   GET /api/messages/:chatId/search
// @access  Private
router.get('/:chatId/search', firebaseProtect, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { query } = req.query;

    console.log(`🔍 Searching messages in chat ${chatId}: "${query}"`);

    if (!query || query.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }

    const isParticipant = chat.users.some(userId => 
      userId.toString() === req.user._id.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this chat'
      });
    }

    // Search in message content and post share content
    const messages = await Message.find({
      chat: chatId,
      $or: [
        { content: { $regex: query, $options: 'i' } },
        { 'postShare.postContent': { $regex: query, $options: 'i' } },
        { 'postShare.sharedText': { $regex: query, $options: 'i' } }
      ]
    })
      .populate('sender', 'name profilePicture firebaseUid')
      .sort({ createdAt: -1 })
      .limit(50);

    console.log(`✅ Found ${messages.length} messages matching "${query}"`);

    res.json({
      success: true,
      data: messages,
      count: messages.length
    });

  } catch (error) {
    console.error('❌ Search messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while searching messages',
      error: error.message
    });
  }
});

// @desc    Get post share messages for a chat
// @route   GET /api/messages/:chatId/post-shares
// @access  Private
router.get('/:chatId/post-shares', firebaseProtect, async (req, res) => {
  try {
    const { chatId } = req.params;

    console.log(`📤 Fetching post shares for chat ${chatId}`);

    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }

    const isParticipant = chat.users.some(userId => 
      userId.toString() === req.user._id.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this chat'
      });
    }

    // Get post share messages
    const postShareMessages = await Message.find({
      chat: chatId,
      messageType: 'post_share'
    })
      .populate('sender', 'name profilePicture firebaseUid')
      .sort({ createdAt: -1 })
      .lean();

    // Format response
    const formattedMessages = postShareMessages.map(message => ({
      _id: message._id,
      content: message.content,
      sender: message.sender,
      chat: message.chat,
      messageType: message.messageType,
      status: message.status,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      postShare: {
        postId: message.postShare?.postId || '',
        postContent: message.postShare?.postContent || '',
        postImage: message.postShare?.postImage || '',
        postAuthor: message.postShare?.postAuthor || {},
        sharedText: message.postShare?.sharedText || '',
        timestamp: message.postShare?.timestamp || message.createdAt
      }
    }));

    console.log(`✅ Found ${formattedMessages.length} post shares in chat ${chatId}`);

    res.json({
      success: true,
      data: formattedMessages,
      count: formattedMessages.length
    });

  } catch (error) {
    console.error('❌ Get post shares error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching post shares',
      error: error.message
    });
  }
});

module.exports = router;