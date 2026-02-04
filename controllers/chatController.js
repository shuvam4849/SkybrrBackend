// controllers/chatController.js
const Chat = require('../models/Chat');
const User = require('../models/User');
const Message = require('../models/Message');

// @desc    Fetch all chats for a user
// @route   GET /api/chat/
// @access  Private
// In your chatController.js, update fetchChats:

const fetchChats = async (req, res) => {
  try {
    const userId = req.user._id;
    
    console.log(`🔍 Fetching chats for user: ${userId}`);
    
    // Get chats
    let chats = await Chat.find({ users: { $elemMatch: { $eq: userId } } })
  .populate('users', 'name email profilePicture firebaseUid isOnline lastSeen')
      .populate('latestMessage')
      .populate('latestMessage.sender', 'name profilePicture')
      .sort({ updatedAt: -1 });
    
    // ✅ UPDATE: Refresh user data for each chat
    chats = await Promise.all(chats.map(async (chat) => {
      const updatedUsers = await Promise.all(chat.users.map(async (user) => {
        // Get fresh data from User collection
        const freshUser = await User.findById(user._id);
        if (freshUser) {
          return {
            _id: freshUser._id,
            name: freshUser.name,  // ← Fresh name!
            email: freshUser.email,
            profilePicture: freshUser.profilePicture,
            firebaseUid: freshUser.firebaseUid,
            // ✅ ADD THESE:
    isOnline: freshUser.isOnline,
    lastSeen: freshUser.lastSeen
          };
        }
        return user;
      }));
      
      return {
        ...chat.toObject(),
        users: updatedUsers
      };
    }));
    
    console.log(`✅ Found ${chats.length} chats for user ${userId}`);
    
    res.json({
      success: true,
      data: chats
    });
    
  } catch (error) {
    console.error('Error fetching chats:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Check if chat exists between users
// @route   GET /api/chat/check/:userId
// @access  Private
const checkExistingChat = async (req, res) => {
  try {
    const { userId } = req.params; // This is Firebase UID from frontend
    
    console.log('🔍 [checkExistingChat] Checking chat for Firebase UID:', userId);
    
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    // Find target user by Firebase UID
    const targetUser = await User.findOne({ firebaseUid: userId });
    
    if (!targetUser) {
      console.log('❌ Target user not found by Firebase UID:', userId);
      return res.json({
        success: true,
        exists: false,
        message: 'User not found in system',
        canMessage: false
      });
    }
    
    console.log(`✅ Target user found: ${targetUser.name} (${targetUser._id})`);
    
    // Check for existing chat between users
    const existingChat = await Chat.findOne({
      isGroupChat: false,
      users: { $all: [req.user._id, targetUser._id] }
    })
    .populate('users', 'name email profilePicture firebaseUid isOnline lastSeen')
    .populate('latestMessage')
    .lean();
    
    let chatExists = !!existingChat;
    let isPendingRequest = false;
    let isActiveChat = true;
    
    if (existingChat) {
      isPendingRequest = existingChat.isPendingRequest || false;
      isActiveChat = existingChat.isActiveChat !== false;
    }
    
    // Check if there's a pending message request
    let pendingMessageRequest = null;
    try {
      const MessageRequest = require('../models/MessageRequest');
      pendingMessageRequest = await MessageRequest.findOne({
        $or: [
          { sender: req.user._id, receiver: targetUser._id, status: 'pending' },
          { sender: targetUser._id, receiver: req.user._id, status: 'pending' }
        ]
      });
    } catch (error) {
      console.log('⚠️ MessageRequest model not available:', error.message);
    }
    
    // Determine if user can be messaged
    let canMessage = false;
    let requiresRequest = false;
    let message = '';
    
    if (chatExists) {
      if (isPendingRequest) {
        canMessage = false;
        requiresRequest = true;
        message = 'Message request pending approval';
      } else if (isActiveChat) {
        canMessage = true;
        message = 'Chat exists and is active';
      } else {
        canMessage = false;
        message = 'Chat is not active';
      }
    } else {
      // Check if target user has private account
      const isPrivateAccount = targetUser.isPrivateAccount || targetUser.isPrivate || false;
      
      if (isPrivateAccount) {
        canMessage = false;
        requiresRequest = true;
        message = 'User has private account, requires message request';
      } else {
        canMessage = true;
        message = 'No chat exists, but user can be messaged';
      }
    }
    
    const response = {
      success: true,
      exists: chatExists,
      canMessage: canMessage,
      requiresRequest: requiresRequest,
      isPendingRequest: isPendingRequest,
      isActiveChat: isActiveChat,
      hasPendingMessageRequest: !!pendingMessageRequest,
      message: message,
      data: existingChat ? {
        _id: existingChat._id,
        users: existingChat.users,
        isGroupChat: existingChat.isGroupChat,
        isPendingRequest: existingChat.isPendingRequest,
        isActiveChat: existingChat.isActiveChat,
        latestMessage: existingChat.latestMessage,
        updatedAt: existingChat.updatedAt
      } : null
    };
    
    console.log('✅ [checkExistingChat] Response:', {
      exists: response.exists,
      canMessage: response.canMessage,
      requiresRequest: response.requiresRequest,
      isPendingRequest: response.isPendingRequest
    });
    
    res.json(response);
    
  } catch (error) {
    console.error('❌ [checkExistingChat] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check chat status',
      error: error.message,
      exists: false,
      canMessage: false
    });
  }
};

// @desc    Create or fetch one on one chat - FIXED VERSION
// @route   POST /api/chat/
// @access  Private
const accessChat = async (req, res) => {
  console.log('🚨 ACCESS CHAT STARTED - Request received');
  
  try {
    const { userId } = req.body; // This is a Firebase UID

    console.log('🔍 [1/6] Starting accessChat - Firebase UID:', userId);
    console.log('👤 [1/6] Current user:', {
      mongoId: req.user._id,
      firebaseUid: req.user.firebaseUid,
      name: req.user.name
    });

    // Basic validation
    if (!req.user || !req.user._id) {
      console.log('❌ [1/6] No authenticated user');
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    if (!userId) {
      console.log('❌ [1/6] No userId provided');
      return res.status(400).json({
        success: false,
        message: 'UserId param not sent with request'
      });
    }

    // Don't allow chatting with yourself
    if (userId === req.user.firebaseUid) {
      console.log('❌ [1/6] Cannot chat with self');
      return res.status(400).json({
        success: false,
        message: 'Cannot start a chat with yourself'
      });
    }

    // Find target user by Firebase UID
    console.log('🔍 [2/6] Looking up target user by Firebase UID:', userId);
    let targetUser = await User.findOne({ firebaseUid: userId }).maxTimeMS(10000); // Add timeout
    
    if (!targetUser) {
      console.log('🔄 [3/6] Target user not found, attempting Firebase sync...');
      try {
        // Import Firebase Admin dynamically to avoid circular dependencies
        const admin = require('firebase-admin');
        console.log('✅ [3/6] Firebase Admin imported successfully');
        
        const firebaseUser = await admin.auth().getUser(userId);
        console.log('✅ [3/6] Firebase user fetched:', firebaseUser.uid);
        
        targetUser = await User.create({
          firebaseUid: userId,
          name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'User',
          email: firebaseUser.email || `${userId}@unknown.com`,
          profilePicture: firebaseUser.photoURL || null,
        });
        
        console.log('✅ [3/6] Auto-created user:', targetUser._id, targetUser.name);
      } catch (syncError) {
        console.error('❌ [3/6] Firebase sync failed:', syncError.message);
        return res.status(404).json({
          success: false,
          message: 'Target user not found and cannot be synced from Firebase'
        });
      }
    } else {
      console.log('✅ [2/6] Target user found:', targetUser._id, targetUser.name);
    }

    console.log('🔍 [4/6] Checking for existing chat...');
    // Use a simpler query to find existing chat
    const existingChat = await Chat.findOne({
      isGroupChat: false,
      users: { $all: [req.user._id, targetUser._id] }
    })
    .populate('users', 'name email profilePicture firebaseUid isOnline lastSeen')
    .populate('latestMessage')
    .maxTimeMS(10000); // Add timeout

    if (existingChat) {
      console.log('✅ [5/6] Existing chat found:', existingChat._id);
      
      // Populate latest message sender if it exists
      if (existingChat.latestMessage) {
        const populatedChat = await User.populate(existingChat, {
          path: 'latestMessage.sender',
          select: 'name profilePicture firebaseUid'
        });
        
        // ✅ ENSURE: Include groupedMedia in latest message
        if (populatedChat.latestMessage && populatedChat.latestMessage.groupedMedia === undefined) {
          populatedChat.latestMessage.groupedMedia = [];
        }
        
        return res.json({
          success: true,
          data: populatedChat,
          exists: true
        });
      }
      
      return res.json({
        success: true,
        data: existingChat,
        exists: true
      });
    }

    // Create new chat
    console.log('👥 [6/6] Creating new chat...');
    const chatData = {
      chatName: 'sender',
      isGroupChat: false,
      users: [req.user._id, targetUser._id],
    };

    const createdChat = await Chat.create(chatData);
    console.log('✅ [6/6] Chat created with ID:', createdChat._id);

    // Populate the created chat with user data
    const fullChat = await Chat.findOne({ _id: createdChat._id })
      .populate('users', 'name email profilePicture firebaseUid isOnline lastSeen');

    console.log('✅ [6/6] Full chat populated:', fullChat._id);

    res.status(201).json({
      success: true,
      data: fullChat,
      exists: false
    });

  } catch (error) {
    console.error('❌ Access chat error:', error);
    
    // Handle specific errors
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }
    
    if (error.name === 'MongoTimeoutError') {
      return res.status(408).json({
        success: false,
        message: 'Database operation timed out'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error while accessing chat',
      error: error.message
    });
  }
};

// @desc    Get media files from a chat
// @route   GET /api/chat/:chatId/media
// @access  Private
const getChatMedia = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { mediaType } = req.query; // Optional: 'image', 'video', 'audio', 'file'
    
    console.log('🖼️ Fetching media for chat:', chatId, 'Type:', mediaType || 'all');

    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    // Verify user has access to this chat
    const chat = await Chat.findOne({
      _id: chatId,
      users: { $elemMatch: { $eq: req.user._id } }
    });

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found or access denied'
      });
    }

    let query = { 
  chat: chatId,
  $or: [
    { 'media.url': { $exists: true, $ne: null } }, // ✅ Check 'url' not 'fileUrl'
    { 'media.fileUrl': { $exists: true, $ne: null } }, // Keep for backward compatibility
    { groupedMedia: { $exists: true, $ne: [], $not: { $size: 0 } } },
    { mediaArray: { $exists: true, $ne: [], $not: { $size: 0 } } } // ✅ ADD THIS!
  ]
};

    // Filter by media type if specified
    if (mediaType) {
      // For single media messages
      if (mediaType === 'image') {
        query['media.mimeType'] = /^image\//;
      } else if (mediaType === 'video') {
        query['media.mimeType'] = /^video\//;
      } else if (mediaType === 'audio') {
        query['media.mimeType'] = /^audio\//;
      }
      
      // For grouped media messages
      query.groupedMedia = query.groupedMedia || {};
    }

    const mediaMessages = await Message.find(query)
      .populate('sender', 'name profilePicture firebaseUid')
      .sort({ createdAt: -1 })
      .lean();

    // ✅ PROCESS: Extract all media items (single + grouped)
    const allMediaItems = [];
    
    mediaMessages.forEach(message => {
      // Add single media item if exists
      if (message.media && message.media.fileUrl) {
        allMediaItems.push({
          messageId: message._id,
          chatId: message.chat,
          sender: message.sender,
          createdAt: message.createdAt,
          type: message.getMediaType ? message.getMediaType() : 'file',
          uri: message.media.url || message.media.fileUrl,
          thumbnailUrl: message.media.thumbnailUrl,
          fileName: message.media.fileName,
          fileSize: message.media.fileSize,
          mimeType: message.media.mimeType,
          duration: message.media.duration,
          width: message.media.width,
          height: message.media.height,
          isGrouped: false,
          indexInGroup: 0,
          caption: message.content
        });
      }
      
      // Add grouped media items if exists
      if (message.groupedMedia && message.groupedMedia.length > 0) {
        message.groupedMedia.forEach((mediaItem, index) => {
          allMediaItems.push({
            messageId: message._id,
            chatId: message.chat,
            sender: message.sender,
            createdAt: message.createdAt,
            type: mediaItem.type,
            uri: mediaItem.url || mediaItem.uri, // ✅ Check 'url' first
            thumbnailUrl: mediaItem.thumbnailUrl,
            fileName: mediaItem.fileName,
            fileSize: mediaItem.fileSize,
            mimeType: mediaItem.mimeType,
            duration: mediaItem.duration,
            width: mediaItem.width,
            height: mediaItem.height,
            isGrouped: true,
            groupSize: message.groupedMedia.length,
            indexInGroup: index,
            caption: mediaItem.caption || message.content
          });
        });
      }
    });

    // Filter by media type if specified (for grouped media)
    let filteredItems = allMediaItems;
    if (mediaType) {
      filteredItems = allMediaItems.filter(item => {
        if (mediaType === 'image') return item.type === 'image';
        if (mediaType === 'video') return item.type === 'video';
        if (mediaType === 'audio') return item.type === 'audio';
        if (mediaType === 'file') return item.type === 'file';
        return true;
      });
    }

    console.log(`✅ Found ${filteredItems.length} media items in chat ${chatId} (${mediaType || 'all types'})`);

    res.json({
      success: true,
      data: {
        mediaItems: filteredItems,
        messages: mediaMessages.length,
        totalItems: filteredItems.length
      },
      count: filteredItems.length
    });

  } catch (error) {
    console.error('❌ Get chat media error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching chat media',
      error: error.message
    });
  }
};

// @desc    Get grouped media messages from a chat
// @route   GET /api/chat/:chatId/grouped-media
// @access  Private
const getGroupedMediaMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    
    console.log('🖼️📦 Fetching grouped media messages for chat:', chatId);

    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    // Verify user has access to this chat
    const chat = await Chat.findOne({
      _id: chatId,
      users: { $elemMatch: { $eq: req.user._id } }
    });

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found or access denied'
      });
    }

    // Get messages with grouped media
    const groupedMediaMessages = await Message.findGroupedMediaMessages(chatId);
    
    // Format the response
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

    console.log(`✅ Found ${formattedMessages.length} grouped media messages in chat ${chatId}`);

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
};

const createGroupChat = async (req, res) => {
  try {
    const { users, name } = req.body;

    console.log('👥 Creating group chat:', name);

    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    if (!users || !name) {
      return res.status(400).json({
        success: false,
        message: 'Please fill all the fields'
      });
    }

    // Parse users if it's a string
    const parsedUsers = typeof users === 'string' ? JSON.parse(users) : users;

    if (parsedUsers.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'More than 2 users are required to form a group chat'
      });
    }

    // Add current user to the group
    parsedUsers.push(req.user._id);

    const groupChat = await Chat.create({
      chatName: name,
      users: parsedUsers,
      isGroupChat: true,
      groupAdmin: req.user._id,
    });

    const fullGroupChat = await Chat.findOne({ _id: groupChat._id })
      .populate('users', '-password')
      .populate('groupAdmin', '-password');

    console.log('✅ Group chat created:', fullGroupChat._id);

    res.status(201).json({
      success: true,
      data: fullGroupChat,
      message: 'Group created successfully'
    });
  } catch (error) {
    console.error('❌ Create group error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating group',
      error: error.message
    });
  }
};

const renameGroup = async (req, res) => {
  try {
    const { chatId, chatName } = req.body;

    console.log('✏️ Renaming group:', chatId, 'to', chatName);

    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const updatedChat = await Chat.findByIdAndUpdate(
      chatId,
      { chatName },
      { new: true }
    )
      .populate('users', '-password')
      .populate('groupAdmin', '-password');

    if (!updatedChat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }

    console.log('✅ Group renamed:', updatedChat._id);

    res.json({
      success: true,
      data: updatedChat,
      message: 'Group renamed successfully'
    });
  } catch (error) {
    console.error('❌ Rename group error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while renaming group',
      error: error.message
    });
  }
};

const addToGroup = async (req, res) => {
  try {
    const { chatId, userId } = req.body;

    console.log('➕ Adding user to group:', userId, 'to', chatId);

    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const added = await Chat.findByIdAndUpdate(
      chatId,
      { $push: { users: userId } },
      { new: true }
    )
      .populate('users', '-password')
      .populate('groupAdmin', '-password');

    if (!added) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }

    console.log('✅ User added to group:', added._id);

    res.json({
      success: true,
      data: added,
      message: 'User added to group successfully'
    });
  } catch (error) {
    console.error('❌ Add to group error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while adding user to group',
      error: error.message
    });
  }
};

const removeFromGroup = async (req, res) => {
  try {
    const { chatId, userId } = req.body;

    console.log('➖ Removing user from group:', userId, 'from', chatId);

    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    // Check if the requester is group admin
    const chat = await Chat.findById(chatId);

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }

    if (chat.groupAdmin.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Only group admin can remove users'
      });
    }

    const removed = await Chat.findByIdAndUpdate(
      chatId,
      { $pull: { users: userId } },
      { new: true }
    )
      .populate('users', '-password')
      .populate('groupAdmin', '-password');

    console.log('✅ User removed from group:', removed._id);

    res.json({
      success: true,
      data: removed,
      message: 'User removed from group successfully'
    });
  } catch (error) {
    console.error('❌ Remove from group error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while removing user from group',
      error: error.message
    });
  }
};

const searchUsers = async (req, res) => {
  try {
    const { query } = req.params;

    console.log('🔍 Searching users:', query);

    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    if (!query || query.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters long'
      });
    }

    const users = await User.find({
      $and: [
        { _id: { $ne: req.user._id } }, // Exclude current user
        {
          $or: [
            { name: { $regex: query, $options: 'i' } },
            { email: { $regex: query, $options: 'i' } }
          ]
        }
      ]
    }).select('name email profilePicture firebaseUid status isOnline lastSeen')

    console.log(`✅ Found ${users.length} users for query: ${query}`);

    res.json({
      success: true,
      data: users,
      count: users.length
    });
  } catch (error) {
    console.error('❌ Search users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while searching users',
      error: error.message
    });
  }
};

// @desc    Search messages in a chat
// @route   GET /api/chat/:chatId/search-messages
// @access  Private
const searchChatMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { query } = req.query;

    console.log('🔍 Searching messages in chat:', chatId, 'Query:', query);

    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    if (!query || query.trim().length < 1) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    // Verify user has access to this chat
    const chat = await Chat.findOne({
      _id: chatId,
      users: { $elemMatch: { $eq: req.user._id } }
    });

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found or access denied'
      });
    }

    // Search messages
    const messages = await Message.find({
      chat: chatId,
      content: { $regex: query, $options: 'i' }
    })
      .populate('sender', 'name profilePicture firebaseUid')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    // Ensure groupedMedia is included
    const messagesWithGroupedMedia = messages.map(message => ({
      ...message,
      groupedMedia: message.groupedMedia || []
    }));

    console.log(`✅ Found ${messagesWithGroupedMedia.length} messages matching "${query}" in chat ${chatId}`);

    res.json({
      success: true,
      data: messagesWithGroupedMedia,
      count: messagesWithGroupedMedia.length
    });

  } catch (error) {
    console.error('❌ Search chat messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while searching messages',
      error: error.message
    });
  }
};

// @desc    Delete a chat (with cascade message deletion)
// @route   DELETE /api/chat/:chatId
// @access  Private
const deleteChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    
    console.log('🗑️ Deleting chat:', chatId, 'for user:', req.user?._id);

    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    // 1. Verify chat exists and user is a participant
    const chat = await Chat.findOne({
      _id: chatId,
      users: { $elemMatch: { $eq: req.user._id } }
    });

    if (!chat) {
      console.log('❌ Chat not found or user not authorized:', chatId);
      return res.status(404).json({
        success: false,
        message: 'Chat not found or you are not a participant'
      });
    }

    console.log('✅ Chat found, checking if it\'s a group chat:', chat.isGroupChat);

    // 2. For one-on-one chats: Remove user from participants
    if (!chat.isGroupChat) {
      console.log('👥 One-on-one chat deletion for user:', req.user._id);
      
      // Remove user from chat participants
      const updatedUsers = chat.users.filter(
        userId => userId.toString() !== req.user._id.toString()
      );
      
      console.log('Users after removal:', updatedUsers.length, 'remaining');

      if (updatedUsers.length === 0) {
        // If no users left, delete the entire chat and messages
        console.log('🗑️ No users left, deleting entire chat...');
        
        // Delete all messages in this chat
        const deleteResult = await Message.deleteMany({ chat: chatId });
        console.log(`🗑️ Deleted ${deleteResult.deletedCount} messages`);
        
        // Delete the chat
        await Chat.findByIdAndDelete(chatId);
        
        console.log('✅ Chat and messages completely deleted');
        
        return res.json({
          success: true,
          message: 'Chat permanently deleted',
          data: {
            chatId,
            messagesDeleted: deleteResult.deletedCount,
            completelyDeleted: true
          }
        });
      } else {
        // User removed from chat, but chat remains for other user
        console.log('👤 User removed from chat, chat remains for other user');
        
        // Update chat without the user
        await Chat.findByIdAndUpdate(chatId, {
          users: updatedUsers,
          updatedAt: Date.now()
        });

        return res.json({
          success: true,
          message: 'Removed from chat',
          data: {
            chatId,
            userRemoved: req.user._id,
            remainingUsers: updatedUsers.length,
            completelyDeleted: false
          }
        });
      }
    } 
    // 3. For group chats: Remove user or delete if admin
    else {
      console.log('👥 Group chat deletion');
      
      // Check if user is the group admin
      const isAdmin = chat.groupAdmin.toString() === req.user._id.toString();
      
      console.log('Is admin?', isAdmin);
      console.log('Group admin:', chat.groupAdmin);
      console.log('Current user:', req.user._id);

      if (isAdmin) {
        // Admin can delete the entire group
        console.log('👑 Admin deleting entire group chat...');
        
        // Delete all messages in this chat
        const deleteResult = await Message.deleteMany({ chat: chatId });
        console.log(`🗑️ Deleted ${deleteResult.deletedCount} messages`);
        
        // Delete the chat
        await Chat.findByIdAndDelete(chatId);
        
        console.log('✅ Group chat completely deleted by admin');
        
        return res.json({
          success: true,
          message: 'Group chat permanently deleted',
          data: {
            chatId,
            messagesDeleted: deleteResult.deletedCount,
            deletedByAdmin: true
          }
        });
      } else {
        // Regular user leaves the group
        console.log('👤 User leaving group chat...');
        
        // Remove user from group participants
        const updatedUsers = chat.users.filter(
          userId => userId.toString() !== req.user._id.toString()
        );
        
        console.log('Users after removal:', updatedUsers.length, 'remaining');

        if (updatedUsers.length === 0) {
          // If no users left (shouldn't happen in groups), delete everything
          console.log('🗑️ No users left in group, deleting everything...');
          
          await Message.deleteMany({ chat: chatId });
          await Chat.findByIdAndDelete(chatId);
          
          return res.json({
            success: true,
            message: 'Group chat deleted (no users left)',
            data: { chatId }
          });
        } else {
          // Update group with remaining users
          await Chat.findByIdAndUpdate(chatId, {
            users: updatedUsers,
            updatedAt: Date.now()
          });
          
          console.log('✅ User removed from group');
          
          return res.json({
            success: true,
            message: 'Left group chat',
            data: {
              chatId,
              userRemoved: req.user._id,
              remainingUsers: updatedUsers.length
            }
          });
        }
      }
    }

  } catch (error) {
    console.error('❌ Delete chat error:', error);
    
    // Handle specific errors
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid chat ID format'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error while deleting chat',
      error: error.message
    });
  }
};

module.exports = {
  accessChat,
  fetchChats,
  createGroupChat,
  renameGroup,
  addToGroup,
  removeFromGroup,
  searchUsers,
  getChatMedia,
  getGroupedMediaMessages,
  searchChatMessages,
  deleteChat,
  checkExistingChat // MAKE SURE THIS IS INCLUDED
};