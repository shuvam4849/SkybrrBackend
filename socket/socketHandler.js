const Message = require('../models/Message');
const Chat = require('../models/Chat');
const User = require('../models/User');
const mongoose = require('mongoose');


// Enhanced status tracking utilities
const connectionTracker = {
  connections: new Map(),
  userConnections: new Map(),
  
  initCleanup() {
    setInterval(() => this.cleanupStaleConnections(), 30000);
  },
  
  cleanupStaleConnections() {
    const now = Date.now();
    for (const [socketId, data] of this.connections.entries()) {
      if (now - (data.lastHeartbeat || data.connectedAt) > 60000) {
        this.removeConnection(socketId);
      }
    }
  },
  
  addConnection(socketId, firebaseUid) {
    this.connections.set(socketId, {
      firebaseUid,
      connectedAt: Date.now(),
      lastHeartbeat: Date.now()
    });
    
    if (!this.userConnections.has(firebaseUid)) {
      this.userConnections.set(firebaseUid, { sockets: new Set() });
    }
    this.userConnections.get(firebaseUid).sockets.add(socketId);
    
    return this.getUserConnectionCount(firebaseUid);
  },
  
  removeConnection(socketId) {
    const connection = this.connections.get(socketId);
    if (!connection) return 0;
    
    const { firebaseUid } = connection;
    this.connections.delete(socketId);
    
    const userData = this.userConnections.get(firebaseUid);
    if (userData) {
      userData.sockets.delete(socketId);
      if (userData.sockets.size === 0) {
        this.userConnections.delete(firebaseUid);
      }
    }
    
    return this.getUserConnectionCount(firebaseUid);
  },
  
  getUserConnectionCount(firebaseUid) {
    return this.userConnections.get(firebaseUid)?.sockets.size || 0;
  },
  
  updateHeartbeat(socketId) {
    const connection = this.connections.get(socketId);
    if (connection) {
      connection.lastHeartbeat = Date.now();
    }
  }
};

// Initialize cleanup
connectionTracker.initCleanup();

const configureSocket = (io) => {
  console.log('🔧 Socket server starting with enhanced status tracking...');
  
  // Track all socket connections globally
  const connectedUsers = new Map(); // socket.id -> user info
  const userSockets = new Map(); // firebaseUid -> Set of socket IDs (multiple device support)
  
  io.on('connection', (socket) => {
    

        // ==================== MESSAGE REQUEST HANDLERS ====================
    
    // Handle sending a message request to a private user
    socket.on('send_message_request', async (data) => {
      try {
        console.log('📩 [message_request] Sending message request:', {
          from: socket.firebaseUid,
          to: data.receiverId,
          message: data.message?.substring(0, 50) + '...'
        });
        
        if (!socket.firebaseUid) {
          socket.emit('message_request_error', {
            error: 'User not authenticated'
          });
          return;
        }
        
        if (!data.receiverId) {
          socket.emit('message_request_error', {
            error: 'Receiver ID is required'
          });
          return;
        }
        
        // Don't allow sending to yourself
        if (data.receiverId === socket.firebaseUid) {
          socket.emit('message_request_error', {
            error: 'Cannot send message request to yourself'
          });
          return;
        }
        
        // Get sender and receiver info
        const sender = await User.findOne({ firebaseUid: socket.firebaseUid });
        const receiver = await User.findOne({ firebaseUid: data.receiverId });
        
        if (!sender) {
          socket.emit('message_request_error', {
            error: 'Sender not found'
          });
          return;
        }
        
        if (!receiver) {
          socket.emit('message_request_error', {
            error: 'Receiver not found'
          });
          return;
        }
        
        // Check for existing chat
        const existingChat = await Chat.findOne({
          isGroupChat: false,
          users: { $all: [sender._id, receiver._id] }
        });
        
        // Emit event to receiver
        io.to(data.receiverId).emit('new_message_request', {
          requestId: `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          sender: {
            firebaseUid: sender.firebaseUid,
            name: sender.name,
            profilePicture: sender.profilePicture
          },
          receiverId: data.receiverId,
          message: data.message || "Hi there! I'd like to message you.",
          chatId: existingChat?._id || null,
          timestamp: new Date().toISOString(),
          isSocketNotification: true // Flag to distinguish from API response
        });
        
        // Confirm to sender
        socket.emit('message_request_sent', {
          success: true,
          receiverId: data.receiverId,
          message: 'Message request sent successfully',
          timestamp: new Date().toISOString()
        });
        
        console.log(`✅ Message request notification sent from ${sender.firebaseUid} to ${receiver.firebaseUid}`);
        
      } catch (error) {
        console.error('❌ [send_message_request] Error:', error);
        socket.emit('message_request_error', {
          error: 'Failed to send message request',
          details: error.message
        });
      }
    });
    
    // Handle accepting a message request
    socket.on('accept_message_request', async (data) => {
      try {
        console.log('✅ [accept_message_request] Accepting request:', {
          requestId: data.requestId,
          chatId: data.chatId,
          accepter: socket.firebaseUid
        });
        
        if (!socket.firebaseUid) {
          socket.emit('message_request_error', {
            error: 'User not authenticated'
          });
          return;
        }
        
        // Get the accepter
        const accepter = await User.findOne({ firebaseUid: socket.firebaseUid });
        if (!accepter) {
          socket.emit('message_request_error', {
            error: 'User not found'
          });
          return;
        }
        
        // Emit to the original sender that their request was accepted
        if (data.senderId) {
          io.to(data.senderId).emit('message_request_accepted', {
            requestId: data.requestId,
            chatId: data.chatId,
            acceptedBy: {
              firebaseUid: accepter.firebaseUid,
              name: accepter.name,
              profilePicture: accepter.profilePicture
            },
            timestamp: new Date().toISOString()
          });
          
          console.log(`✅ Notified sender ${data.senderId} that request was accepted`);
        }
        
        // Also update the chat if it exists
        if (data.chatId) {
          // Mark chat as active (not pending request anymore)
          await Chat.findByIdAndUpdate(data.chatId, {
            isPendingRequest: false,
            isActiveChat: true,
            updatedAt: new Date()
          });
          
          // Notify both users that chat is now active
          const chat = await Chat.findById(data.chatId).populate('users', 'firebaseUid');
          if (chat) {
            chat.users.forEach(user => {
              if (user.firebaseUid) {
                io.to(user.firebaseUid).emit('chat_activated', {
                  chatId: data.chatId,
                  isActive: true,
                  timestamp: new Date().toISOString()
                });
              }
            });
          }
        }
        
        // Confirm to accepter
        socket.emit('message_request_accepted_success', {
          success: true,
          requestId: data.requestId,
          chatId: data.chatId,
          message: 'Message request accepted successfully',
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        console.error('❌ [accept_message_request] Error:', error);
        socket.emit('message_request_error', {
          error: 'Failed to accept message request',
          details: error.message
        });
      }
    });
    
    // Handle rejecting a message request
    socket.on('reject_message_request', async (data) => {
      try {
        console.log('❌ [reject_message_request] Rejecting request:', {
          requestId: data.requestId,
          chatId: data.chatId,
          rejecter: socket.firebaseUid,
          reason: data.reason
        });
        
        if (!socket.firebaseUid) {
          socket.emit('message_request_error', {
            error: 'User not authenticated'
          });
          return;
        }
        
        // Get the rejecter
        const rejecter = await User.findOne({ firebaseUid: socket.firebaseUid });
        if (!rejecter) {
          socket.emit('message_request_error', {
            error: 'User not found'
          });
          return;
        }
        
        // Emit to the original sender that their request was rejected
        if (data.senderId) {
          io.to(data.senderId).emit('message_request_rejected', {
            requestId: data.requestId,
            chatId: data.chatId,
            rejectedBy: {
              firebaseUid: rejecter.firebaseUid,
              name: rejecter.name
            },
            reason: data.reason || 'not_interested',
            timestamp: new Date().toISOString()
          });
          
          console.log(`✅ Notified sender ${data.senderId} that request was rejected`);
        }
        
        // Also update the chat if it exists
        if (data.chatId) {
          // Archive the chat (or delete if you prefer)
          await Chat.findByIdAndUpdate(data.chatId, {
            isArchived: true,
            updatedAt: new Date()
          });
          
          // Notify both users that chat was rejected
          const chat = await Chat.findById(data.chatId).populate('users', 'firebaseUid');
          if (chat) {
            chat.users.forEach(user => {
              if (user.firebaseUid) {
                io.to(user.firebaseUid).emit('chat_rejected', {
                  chatId: data.chatId,
                  rejected: true,
                  timestamp: new Date().toISOString()
                });
              }
            });
          }
        }
        
        // Confirm to rejecter
        socket.emit('message_request_rejected_success', {
          success: true,
          requestId: data.requestId,
          message: 'Message request rejected successfully',
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        console.error('❌ [reject_message_request] Error:', error);
        socket.emit('message_request_error', {
          error: 'Failed to reject message request',
          details: error.message
        });
      }
    });
    
    // Handle checking message request status
    socket.on('check_message_request', async (data) => {
      try {
        console.log('🔍 [check_message_request] Checking request status:', {
          userId: data.userId,
          checker: socket.firebaseUid
        });
        
        if (!socket.firebaseUid) {
          socket.emit('message_request_error', {
            error: 'User not authenticated'
          });
          return;
        }
        
        // Check if there's a pending request between users
        const [sender, receiver] = await Promise.all([
          User.findOne({ firebaseUid: socket.firebaseUid }),
          User.findOne({ firebaseUid: data.userId })
        ]);
        
        if (!sender || !receiver) {
          socket.emit('check_message_request_response', {
            exists: false,
            error: 'User not found'
          });
          return;
        }
        
        // Check for existing chat with pending request status
        const existingChat = await Chat.findOne({
          isGroupChat: false,
          users: { $all: [sender._id, receiver._id] },
          isPendingRequest: true
        });
        
        const response = {
          exists: !!existingChat,
          hasPendingRequest: !!existingChat,
          chatId: existingChat?._id,
          users: {
            sender: {
              firebaseUid: sender.firebaseUid,
              name: sender.name
            },
            receiver: {
              firebaseUid: receiver.firebaseUid,
              name: receiver.name
            }
          }
        };
        
        socket.emit('check_message_request_response', response);
        
        console.log(`✅ Checked message request status: ${response.exists ? 'Pending request exists' : 'No pending request'}`);
        
      } catch (error) {
        console.error('❌ [check_message_request] Error:', error);
        socket.emit('check_message_request_response', {
          exists: false,
          error: error.message
        });
      }
    });
    
    // Handle getting message request count (for badge)
    socket.on('get_message_request_count', async () => {
      try {
        if (!socket.firebaseUid) return;
        
        const user = await User.findOne({ firebaseUid: socket.firebaseUid });
        if (!user) return;
        
        // In a real implementation, you would query MessageRequest model
        // For now, send a mock count (frontend will get real count via API)
        socket.emit('message_request_count', {
          count: 0, // Placeholder - frontend will fetch via API
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        console.error('❌ [get_message_request_count] Error:', error);
      }
    });
    
    // Handle message request read status
    socket.on('mark_message_request_read', async (data) => {
      try {
        console.log('📖 [mark_message_request_read] Marking as read:', {
          requestId: data.requestId,
          reader: socket.firebaseUid
        });
        
        if (!socket.firebaseUid) return;
        
        // Notify sender that their request was viewed
        if (data.senderId) {
          io.to(data.senderId).emit('message_request_viewed', {
            requestId: data.requestId,
            viewedBy: socket.firebaseUid,
            timestamp: new Date().toISOString()
          });
        }
        
        socket.emit('message_request_marked_read', {
          success: true,
          requestId: data.requestId
        });
        
      } catch (error) {
        console.error('❌ [mark_message_request_read] Error:', error);
      }
    });


    console.log('✅ User connected:', socket.id, 
      'Total connections:', io.engine.clientsCount,
      'Unique users:', userSockets.size
    );
    
    let heartbeatInterval;
    let connectionStartTime = Date.now();

       // ✅ FIXED: Enhanced user status update with atomic operations
const updateUserStatus = async (firebaseUid, isOnline, source = 'unknown') => {
  try {
    console.log(`🔄 [${source}] Updating status for ${firebaseUid}: ${isOnline ? 'ONLINE' : 'OFFLINE'}`);
    
    // Use atomic operation to prevent race conditions
    const updateQuery = isOnline 
      ? { 
          $inc: { connectionCount: 1 },
          $set: { 
            isOnline: true,
            lastSeen: new Date()
          }
        }
      : { 
          $inc: { connectionCount: -1 },
          $set: { 
            lastSeen: new Date() // Always update lastSeen!
          }
        };
    
    const options = {
      new: true,
      upsert: true,
      runValidators: true
    };
    
    let user = await User.findOneAndUpdate(
      { firebaseUid },
      updateQuery,
      options
    );
    
    if (!user) {
      console.error(`❌ [${source}] User not found: ${firebaseUid}`);
      return null;
    }
    
    // After updating connectionCount, check if user should be online or offline
    const finalConnectionCount = user.connectionCount || 0;
    const shouldBeOnline = finalConnectionCount > 0;

    // For offline: check if connectionCount reached 0 and adjust
    if (user.isOnline !== shouldBeOnline) {
      // If connectionCount is negative (shouldn't happen), reset to 0
      if (user.isOnline !== shouldBeOnline) {
      user = await User.findOneAndUpdate(
        { firebaseUid },
        { 
          $set: { 
            isOnline: shouldBeOnline
          }
        },
        { new: true }
      );
    }
  else if (user.connectionCount > 0) {
  user = await User.findOneAndUpdate(
    { firebaseUid },
    { 
      $set: { 
        isOnline: true,
        lastSeen: new Date() // ✅ KEEP the lastSeen update!
      }
    },
    { new: true }
  );
}
    }
    
    if (!user) {
      console.error(`❌ [${source}] User not found: ${firebaseUid}`);
      return null;
    }
    
    // Only broadcast if status actually changed
    const statusChanged = user.isOnline !== isOnline;
    
    // Add formatted status text
    const formatStatusText = (isOnline, lastSeen) => {
      if (isOnline) return 'Online';
      if (!lastSeen) return 'Offline';
      
      const now = new Date();
      const lastSeenDate = new Date(lastSeen);
      const diffMs = now - lastSeenDate;
      const diffMin = Math.floor(diffMs / 60000);
      
      if (diffMin < 1) return 'Just now';
      if (diffMin < 60) return `Last seen ${diffMin} minute${diffMin > 1 ? 's' : ''} ago`;
      
      const diffHour = Math.floor(diffMin / 60);
      if (diffHour < 24) return `Last seen ${diffHour} hour${diffHour > 1 ? 's' : ''} ago`;
      
      return `Last seen ${lastSeenDate.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
    };
    
    if (statusChanged || source === 'heartbeat') {
      const statusData = {
        firebaseUid: user.firebaseUid,
        userId: user._id,
        isOnline: user.isOnline,
        connectionCount: user.connectionCount || 0,
        lastSeen: user.lastSeen,
        name: user.name,
        source: source,
        timestamp: new Date().toISOString(),
        statusText: formatStatusText(user.isOnline, user.lastSeen) // ✅ ADD FORMATTED TEXT
      };
      
      // Broadcast to all connected clients
      io.emit('userStatusChanged', statusData);
      
      // Specific events for frontend
      if (user.isOnline) {
        io.emit('userOnline', {
          userId: user.firebaseUid,
          firebaseUid: user.firebaseUid,
          name: user.name,
          connectionCount: user.connectionCount,
          timestamp: new Date().toISOString(),
          statusText: 'Online'
        });
      } else {
        io.emit('userOffline', {
          userId: user.firebaseUid,
          firebaseUid: user.firebaseUid,
          name: user.name,
          lastSeen: user.lastSeen,
          timestamp: new Date().toISOString(),
          statusText: formatStatusText(false, user.lastSeen) // ✅ ADD FORMATTED TEXT
        });
      }
      
      console.log(`✅ [${source}] Status updated: ${user.name} is ${user.isOnline ? 'ONLINE' : 'OFFLINE'} (${user.connectionCount} connections)`);
    }
    
    return user;
  } catch (error) {
    console.error(`❌ [${source}] Error updating status for ${firebaseUid}:`, error);
    return null;
  }
};

    // Helper function: Get user's active socket connections
    const getUserActiveConnections = (firebaseUid) => {
      return userSockets.has(firebaseUid) ? userSockets.get(firebaseUid).size : 0;
    };

    // Helper function: Check if user is actually connected to socket (not just DB online)
    const isUserActuallyConnected = (firebaseUid) => {
      if (!userSockets.has(firebaseUid)) return false;
      
      const socketIds = userSockets.get(firebaseUid);
      for (const socketId of socketIds) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket && socket.connected) {
          return true;
        }
      }
      return false;
    };

    // Helper function: Handle delayed delivery when user comes online
    const handleDelayedDelivery = async (firebaseUid) => {
      try {
        const user = await User.findOne({ firebaseUid });
        if (!user) return;

        // Find messages pending delivery to this user
        const pendingMessages = await Message.find({
          chat: { $in: await Chat.find({ users: user._id }).distinct('_id') },
          status: 'pending',
          sender: { $ne: user._id }
        }).populate('sender', 'firebaseUid name');

        if (pendingMessages.length > 0) {
          console.log(`⏰ Delivering ${pendingMessages.length} pending messages to ${firebaseUid}`);
          
          for (const message of pendingMessages) {
            // Format message
            const formattedMessage = {
              _id: message._id,
              content: message.content,
              sender: {
                _id: message.sender._id,
                firebaseUid: message.sender.firebaseUid,
                name: message.sender.name
              },
              chat: message.chat,
              messageType: message.messageType,
              status: 'sent',
              createdAt: message.createdAt
            };

            // Send to recipient
            io.to(firebaseUid).emit('messageReceived', formattedMessage);
            
            // Notify sender of delayed delivery
            const senderSockets = userSockets.get(message.sender.firebaseUid);
            if (senderSockets) {
              for (const senderSocketId of senderSockets) {
                const senderSocket = io.sockets.sockets.get(senderSocketId);
                if (senderSocket && senderSocket.connected) {
                  senderSocket.emit('delayedDelivery', {
                    messageId: message._id,
                    chatId: message.chat,
                    recipientId: firebaseUid,
                    delayed: true,
                    originalTimestamp: message.createdAt,
                    deliveredTimestamp: new Date().toISOString()
                  });
                }
              }
            }

            // Update message status
            message.status = 'sent';
            message.deliveredTo.push(user._id);
            await message.save();
          }
        }
      } catch (error) {
        console.error('❌ Error handling delayed delivery:', error);
      }
    };

    socket.on('setup', async (userData) => {
  try {
    if (userData && userData.firebaseUid) {
      // Find user by Firebase UID
      const user = await User.findOne({ firebaseUid: userData.firebaseUid });
      
      if (!user) {
        console.error(`❌ [setup] User not found for Firebase UID: ${userData.firebaseUid}`);
        socket.emit('setup_error', { error: 'User not found' });
        return;
      }

      // Store user info on socket
      socket.userId = user._id;
      socket.firebaseUid = userData.firebaseUid;
      socket.userName = user.name;
      
      // Track connection
      connectedUsers.set(socket.id, {
        userId: user._id,
        firebaseUid: userData.firebaseUid,
        socketId: socket.id,
        connectedAt: new Date()
      });
      
      // Track user's sockets (multiple device support)
      if (!userSockets.has(userData.firebaseUid)) {
        userSockets.set(userData.firebaseUid, new Set());
      }
      userSockets.get(userData.firebaseUid).add(socket.id);
      
      // Join user's personal room
      socket.join(userData.firebaseUid);
      console.log(`✅ [setup] User ${user.name} (${userData.firebaseUid}) joined room, connections: ${getUserActiveConnections(userData.firebaseUid)}`);
      
      // ✅ FIXED: Use connection tracker for accurate counting
      const connectionCount = connectionTracker.addConnection(socket.id, userData.firebaseUid);
      const shouldMarkOnline = connectionCount === 1; // Only mark online if first connection

      await updateUserStatus(userData.firebaseUid, shouldMarkOnline, 'setup');
      
      // Setup heartbeat listener
      socket.on('heartbeat_ack', (data) => {
        socket.lastHeartbeat = Date.now();
        connectionTracker.updateHeartbeat(socket.id);
        
        // Also update lastSeen in database periodically
        if (socket.firebaseUid && Date.now() % 30000 < 1000) {
          updateUserStatus(socket.firebaseUid, true, 'heartbeat');
        }
      });
      
      // Notify user about successful setup
      socket.emit('setup_complete', {
        firebaseUid: userData.firebaseUid,
        userId: user._id,
        isOnline: shouldMarkOnline,
        activeConnections: connectionCount,
        timestamp: new Date().toISOString()
      });

      console.log(`✅ [setup] ${user.name} setup complete, ${connectionCount} active connection(s)`); // ✅ FIXED HERE
    } else {
      console.error('❌ [setup] Invalid user data:', userData);
      socket.emit('setup_error', { error: 'Invalid user data' });
    }
  } catch (error) {
    console.error('❌ [setup] Setup error:', error);
    socket.emit('setup_error', { 
      error: 'Setup failed',
      details: error.message 
    });
  }
});

    // Handle heartbeat acknowledgment
    socket.on('heartbeat_ack', (data) => {
      // Optional: Track last heartbeat time for connection health
      socket.lastHeartbeat = Date.now();
    });

    // Join chat room
    socket.on('join chat', (room) => {
      socket.join(room);
      console.log(`🎯 User ${socket.firebaseUid} joined chat room: ${room}`);
      
      // Notify others in the chat
      socket.to(room).emit('user_joined_chat', {
        chatId: room,
        userId: socket.firebaseUid,
        userName: socket.userName,
        timestamp: new Date().toISOString()
      });
    });

    // Leave chat room
    socket.on('leave chat', (room) => {
      socket.leave(room);
      console.log(`🚪 User ${socket.firebaseUid} left chat room: ${room}`);
      
      // Notify others in the chat
      socket.to(room).emit('user_left_chat', {
        chatId: room,
        userId: socket.firebaseUid,
        userName: socket.userName,
        timestamp: new Date().toISOString()
      });
    });



   socket.on('send_message', async (messageData) => {
  try {
    console.log('📤 [send_message] Received message:', {
      chat: messageData.chat,
      sender: messageData.sender,
      content: messageData.content?.substring(0, 50),
      messageType: messageData.messageType,
      isPost: messageData.isPost || messageData.messageType === 'post_share',
      // ✅ ADD METADATA LOGGING
      hasMetadata: !!messageData.metadata,
      uploadId: messageData.metadata?.uploadId,
      tempMessageId: messageData.metadata?.tempMessageId,
      batchId: messageData.metadata?.batchId,
      // ✅ ADD MEDIA LOGGING
      hasMediaArray: !!messageData.media && messageData.media.length > 0,
      mediaCount: messageData.media?.length || 0,
      hasFileUrl: !!messageData.fileUrl,
      fileUrl: messageData.fileUrl?.substring(0, 50) + '...'
    });

    // ✅ 1. HANDLE GROUPED MEDIA SPECIFICALLY
    if (messageData.messageType === 'grouped_media' || 
        (messageData.media?.length > 1) || 
        messageData.isGrouped) {
      
      console.log('📦📦📦 Processing GROUPED MEDIA message:', {
        messageType: messageData.messageType,
        mediaCount: messageData.media?.length || 0,
        isGrouped: messageData.isGrouped,
        hasGroupedMedia: !!messageData.groupedMedia,
        // ✅ LOG METADATA
        metadata: messageData.metadata
      });

      // Find user
      const user = await User.findOne({ firebaseUid: messageData.sender });
      if (!user) {
        throw new Error(`User not found: ${messageData.sender}`);
      }

      // ✅ Get media array (could be in 'media' or 'groupedMedia' field)
      let mediaArray = [];
      if (messageData.media && Array.isArray(messageData.media)) {
        mediaArray = messageData.media;
      } else if (messageData.groupedMedia && Array.isArray(messageData.groupedMedia)) {
        mediaArray = messageData.groupedMedia;
      }
      
      console.log(`📊 Grouped media has ${mediaArray.length} items`);

      // ✅ Format media for MongoDB
      const formattedGroupedMedia = mediaArray.map((media, index) => ({
        uri: media.url || media.uri || media.fileUrl,
        type: media.type || 'image',
        fileName: media.fileName || media.name || `File ${index + 1}`,
        fileSize: media.fileSize || media.size || 0,
        mimeType: media.mimeType || 'application/octet-stream',
        thumbnailUrl: media.thumbnailUrl || media.url || media.uri || media.fileUrl,
        width: media.width || 0,
        height: media.height || 0,
        duration: media.duration || 0,
        caption: media.caption || ''
      }));

      console.log('✅ Formatted grouped media for MongoDB');

      // ✅ Create message with GROUPED MEDIA and METADATA
      let message = await Message.create({
        sender: user._id,
        chat: messageData.chat,
        content: messageData.content || `Sent ${formattedGroupedMedia.length} files`,
        messageType: 'grouped_media',
        isGrouped: true,
        groupedMedia: formattedGroupedMedia,
        // For backward compatibility
        fileUrl: formattedGroupedMedia.length > 0 ? formattedGroupedMedia[0].uri : null,
        media: formattedGroupedMedia,
        // ✅ CRITICAL: PRESERVE METADATA FROM FRONTEND
        metadata: messageData.metadata || {},
        status: 'sent',
        deliveredTo: [],
        readBy: []
      });

      console.log('💾 Grouped media saved to MongoDB with metadata:', {
        _id: message._id,
        groupedMediaCount: message.groupedMedia?.length || 0,
        metadata: message.metadata
      });

      // Populate message
      message = await Message.findById(message._id)
        .populate('sender', 'name profilePicture firebaseUid')
        .populate('chat');

      // Update chat
      await Chat.findByIdAndUpdate(messageData.chat, {
        latestMessage: message._id,
        updatedAt: new Date()
      });

      // ✅ FORMAT FOR SOCKET EMISSION WITH METADATA
      const formattedMessage = {
        _id: message._id,
        content: message.content,
        sender: {
          _id: message.sender._id,
          firebaseUid: message.sender.firebaseUid,
          name: message.sender.name,
          profilePicture: message.sender.profilePicture
        },
        chat: message.chat._id,
        messageType: 'grouped_media',
        isGrouped: true,
        // ✅ CRITICAL: INCLUDE GROUPED MEDIA IN RESPONSE
        groupedMedia: message.groupedMedia,
        media: message.groupedMedia,
        // For backward compatibility
        fileUrl: message.fileUrl,
        // ✅ CRITICAL: RETURN METADATA TO FRONTEND
        metadata: message.metadata || messageData.metadata || {},
        status: message.status,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt
      };

      console.log('📡 Emitting grouped media to chat with metadata:', {
        messageId: message._id,
        groupedMediaCount: formattedMessage.groupedMedia?.length || 0,
        metadata: formattedMessage.metadata
      });

      // 🔥 ALSO send direct confirmation to sender:
console.log('🎯 [DEBUG] EMITTING EVENT: "message_sent" to sender');
socket.emit('message_sent', {
  messageId: message._id,
  chatId: messageData.chat,
  status: 'sent',
  metadata: formattedMessage.metadata,
  tempMessageId: messageData.metadata?.tempMessageId,
  batchId: messageData.metadata?.batchId,
  timestamp: new Date().toISOString()
});

      // 🔥 ADD THIS RIGHT BEFORE THE EMIT:
console.log('🎯 [DEBUG] EMITTING EVENT: "messageReceived" to chat', messageData.chat);

// THEN emit:
io.to(messageData.chat).emit('messageReceived', formattedMessage);
      
      console.log(`✅ Grouped media broadcast with metadata to chat ${messageData.chat}`);
      
      return; // Exit early
    }

    // ✅ HANDLE POST_SHARE MESSAGES
    if (messageData.messageType === 'post_share' || messageData.isPost || messageData.type === 'post') {
      console.log('📱 [share_post] Processing post share:', {
        metadata: messageData.metadata
      });
      
      // Find user
      const user = await User.findOne({ firebaseUid: messageData.sender });
      if (!user) {
        throw new Error(`User not found: ${messageData.sender}`);
      }

      const postData = messageData.postData || messageData;
      
      // Create message with metadata
      const messageToCreate = {
        sender: user._id,
        chat: messageData.chat,
        content: messageData.shareText || "Check this out!",
        messageType: 'post',
        isPost: true,
        type: 'post',
        postId: postData.id,
        postData: postData,
        shareText: messageData.shareText,
        media: postData.media || [],
        image: postData.image || postData.imageUrl || '',
        video: postData.video || '',
        authorName: postData.authorName,
        authorAvatar: postData.authorAvatar,
        // ✅ PRESERVE METADATA
        metadata: messageData.metadata || {},
        status: 'sent',
        deliveredTo: [],
        readBy: []
      };

      let message = await Message.create(messageToCreate);

      message = await Message.findById(message._id)
        .populate('sender', 'name profilePicture firebaseUid')
        .populate('chat');

      await Chat.findByIdAndUpdate(messageData.chat, {
        latestMessage: message._id,
        updatedAt: new Date()
      });

      // Format with metadata
      const formattedMessage = {
        _id: message._id,
        content: messageData.shareText || "Check this out!",
        sender: {
          _id: message.sender._id,
          firebaseUid: message.sender.firebaseUid,
          name: message.sender.name,
          profilePicture: message.sender.profilePicture
        },
        chat: message.chat._id,
        messageType: 'post',
        isPost: true,
        type: 'post',
        id: postData.id,
        postId: postData.id,
        postData: postData,
        media: postData.media || [],
        image: postData.image || postData.imageUrl || '',
        video: postData.video || '',
        authorId: postData.authorId,
        authorName: postData.authorName,
        authorAvatar: postData.authorAvatar,
        shareText: messageData.shareText,
        // ✅ INCLUDE METADATA
        metadata: message.metadata || messageData.metadata || {},
        timestamp: new Date(),
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
        status: 'sent'
      };

      // Confirm to sender with metadata
      socket.emit('message_sent', {
        messageId: message._id,
        chatId: messageData.chat,
        status: 'sent',
        metadata: formattedMessage.metadata,
        timestamp: new Date().toISOString(),
        isPost: true
      });

      // Broadcast with metadata
      io.to(messageData.chat).emit('messageReceived', formattedMessage);
      
      return; // Exit early
    }

    // ✅ HANDLE MEDIA MESSAGES (IMAGES, VIDEOS, ETC.)
    if (messageData.messageType === 'image' || messageData.messageType === 'video' || 
        messageData.messageType === 'audio' || messageData.media?.length > 0) {
      
      console.log('🖼️ Processing MEDIA message with metadata:', {
        messageType: messageData.messageType,
        metadata: messageData.metadata
      });

      // Find user
      const user = await User.findOne({ firebaseUid: messageData.sender });
      if (!user) {
        throw new Error(`User not found: ${messageData.sender}`);
      }

      // Process media data
      let mediaArray = [];
      let fileUrl = messageData.fileUrl;
      
      if (messageData.media && messageData.media.length > 0) {
        mediaArray = messageData.media.map(media => ({
          url: media.url || media.uri || media.fileUrl,
          type: media.type || messageData.messageType || 'image',
          fileName: media.fileName || media.name || 'file',
          fileSize: media.fileSize || 0,
          mimeType: media.mimeType || 'application/octet-stream',
          thumbnailUrl: media.thumbnailUrl || null,
          width: media.width || 0,
          height: media.height || 0,
          duration: media.duration || 0,
          caption: media.caption || ''
        }));
        
        if (mediaArray.length > 0 && !fileUrl) {
          fileUrl = mediaArray[0].url;
        }
      }

      // Create message with metadata
      const messageToCreate = {
        sender: user._id,
        chat: messageData.chat,
        content: messageData.content || (messageData.messageType === 'image' ? '📷' : '🎬'),
        messageType: messageData.messageType,
        fileUrl: fileUrl,
        media: mediaArray,
        image: messageData.image || (messageData.messageType === 'image' ? fileUrl : undefined),
        video: messageData.video || (messageData.messageType === 'video' ? fileUrl : undefined),
        fileName: messageData.fileName,
        fileSize: messageData.fileSize,
        mimeType: messageData.mimeType,
        thumbnailUrl: messageData.thumbnailUrl,
        // ✅ PRESERVE METADATA FROM FRONTEND
        metadata: messageData.metadata || {},
        status: 'sent',
        deliveredTo: [],
        readBy: []
      };

      let message = await Message.create(messageToCreate);

      message = await Message.findById(message._id)
        .populate('sender', 'name profilePicture firebaseUid')
        .populate('chat');

      await Chat.findByIdAndUpdate(messageData.chat, {
        latestMessage: message._id,
        updatedAt: new Date()
      });

      // Format for socket with metadata
      const formattedMessage = {
        _id: message._id,
        content: message.content,
        sender: {
          _id: message.sender._id,
          firebaseUid: message.sender.firebaseUid,
          name: message.sender.name,
          profilePicture: message.sender.profilePicture
        },
        chat: message.chat._id,
        messageType: message.messageType,
        fileUrl: message.fileUrl,
        media: message.media,
        image: message.image,
        video: message.video,
        fileName: message.fileName,
        fileSize: message.fileSize,
        thumbnailUrl: message.thumbnailUrl,
        mimeType: message.mimeType,
        // ✅ RETURN METADATA TO FRONTEND
        metadata: message.metadata || messageData.metadata || {},
        status: message.status,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt
      };

      // Confirm to sender with metadata
      socket.emit('message_sent', {
        messageId: message._id,
        chatId: messageData.chat,
        status: 'sent',
        // ✅ INCLUDE METADATA IN CONFIRMATION
        metadata: formattedMessage.metadata,
        uploadId: messageData.metadata?.uploadId,
        tempMessageId: messageData.metadata?.tempMessageId,
        timestamp: new Date().toISOString(),
        isMedia: true,
        hasMedia: !!formattedMessage.media
      });

      // Broadcast with metadata
      io.to(messageData.chat).emit('messageReceived', formattedMessage);
      
      return; // Exit early
    }

    // ✅ REGULAR TEXT MESSAGES HANDLING
    console.log('📝 Processing REGULAR TEXT message with metadata:', {
      metadata: messageData.metadata
    });
    
    // Find user
    const user = await User.findOne({ firebaseUid: messageData.sender });
    if (!user) {
      throw new Error(`User not found: ${messageData.sender}`);
    }

    // Create message with metadata
    let message = await Message.create({
      sender: user._id,
      chat: messageData.chat,
      content: messageData.content,
      messageType: messageData.messageType || 'text',
      // ✅ PRESERVE METADATA
      metadata: messageData.metadata || {},
      status: 'sent',
      deliveredTo: [],
      readBy: []
    });

    message = await Message.findById(message._id)
      .populate('sender', 'name profilePicture firebaseUid')
      .populate('chat');

    await Chat.findByIdAndUpdate(messageData.chat, {
      latestMessage: message._id,
      updatedAt: new Date()
    });

    // Format with metadata
    const formattedMessage = {
      _id: message._id,
      content: message.content,
      sender: {
        _id: message.sender._id,
        firebaseUid: message.sender.firebaseUid,
        name: message.sender.name,
        profilePicture: message.sender.profilePicture
      },
      chat: message.chat._id,
      messageType: message.messageType,
      // ✅ RETURN METADATA
      metadata: message.metadata || messageData.metadata || {},
      status: message.status,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt
    };

    console.log('✅ Regular message created with metadata:', {
      messageId: message._id,
      metadata: formattedMessage.metadata
    });

    // ✅ SEND CONFIRMATION TO SENDER WITH METADATA
    socket.emit('message_sent', {
      messageId: message._id,
      chatId: messageData.chat,
      status: 'sent',
      // ✅ INCLUDE METADATA
      metadata: formattedMessage.metadata,
      uploadId: messageData.metadata?.uploadId,
      tempMessageId: messageData.metadata?.tempMessageId,
      timestamp: new Date().toISOString()
    });

    // ✅ BROADCAST TO ALL USERS IN CHAT WITH METADATA
    io.to(messageData.chat).emit('messageReceived', formattedMessage);
    
    console.log(`📡 Message broadcast with metadata to chat ${messageData.chat}`);

  } catch (error) {
    console.error('❌ [send_message] Error:', error);
    socket.emit('message_error', { 
      error: 'Failed to send message',
      details: error.message 
    });
  }
});

    // Handle user trying to message a private account
    socket.on('attempt_private_message', async (data) => {
      try {
        console.log('🔒 [attempt_private_message] User attempting to message private account:', {
          sender: socket.firebaseUid,
          receiver: data.receiverId,
          message: data.message?.substring(0, 50) + '...'
        });
        
        if (!socket.firebaseUid || !data.receiverId) {
          socket.emit('private_message_error', {
            error: 'Missing required fields'
          });
          return;
        }
        
        // Get receiver info
        const receiver = await User.findOne({ firebaseUid: data.receiverId });
        if (!receiver) {
          socket.emit('private_message_error', {
            error: 'User not found'
          });
          return;
        }
        
        // Check if receiver has private account
        // (You'll need to add isPrivateAccount field to User model)
        // For now, we'll assume private if isPendingRequest exists
        
        // Get sender info
        const sender = await User.findOne({ firebaseUid: socket.firebaseUid });
        if (!sender) {
          socket.emit('private_message_error', {
            error: 'Sender not found'
          });
          return;
        }
        
        // Check if there's already a pending chat
        const existingChat = await Chat.findOne({
          isGroupChat: false,
          users: { $all: [sender._id, receiver._id] },
          isPendingRequest: true
        });
        
        if (existingChat) {
          socket.emit('private_message_response', {
            requiresRequest: true,
            hasPendingRequest: true,
            chatId: existingChat._id,
            message: 'You already have a pending message request with this user'
          });
          return;
        }
        
        // Check if they already have an active chat
        const activeChat = await Chat.findOne({
          isGroupChat: false,
          users: { $all: [sender._id, receiver._id] },
          isPendingRequest: false,
          isActiveChat: true
        });
        
        if (activeChat) {
          socket.emit('private_message_response', {
            requiresRequest: false,
            hasActiveChat: true,
            chatId: activeChat._id,
            message: 'You already have an active chat with this user'
          });
          return;
        }
        
        // If no existing chat and receiver is private, require message request
        socket.emit('private_message_response', {
          requiresRequest: true,
          receiverName: receiver.name,
          receiverProfilePicture: receiver.profilePicture,
          message: `${receiver.name} has a private account. Send a message request first.`
        });
        
      } catch (error) {
        console.error('❌ [attempt_private_message] Error:', error);
        socket.emit('private_message_error', {
          error: 'Failed to check private message status',
          details: error.message
        });
      }
    });

    // ✅ ADD THIS: Handle post sharing via socket
socket.on('share_post', async (shareData) => {
  try {
    console.log('📱 [share_post] Received post share request:', {
      chatId: shareData.chat,
      postId: shareData.postData?.id,
      sender: shareData.sender,
      shareText: shareData.shareText,
      mediaCount: shareData.postData?.media?.length || 0,
      isPost: true
    });

    // Validate required fields
    if (!shareData.chat || !shareData.sender || !shareData.postData) {
      throw new Error('Missing required fields for post sharing');
    }

    // Find user
    const user = await User.findOne({ firebaseUid: shareData.sender });
    if (!user) {
      throw new Error(`User not found: ${shareData.sender}`);
    }

    // Get post data
    const postData = shareData.postData;
    
    // ✅ CRITICAL: Format message for MongoDB storage
    const messageToCreate = {
      sender: user._id,
      chat: shareData.chat,
      content: shareData.shareText || "Check this out!",
      messageType: 'post',
      isPost: true,
      type: 'post',
      // Store complete post data
      postId: postData.id,
      postData: postData,
      shareText: shareData.shareText,
      // Media data for display
      media: postData.media || [],
      image: postData.image || postData.imageUrl || '',
      video: postData.video || '',
      authorName: postData.authorName,
      authorAvatar: postData.authorAvatar,
      status: 'sent',
      deliveredTo: [],
      readBy: []
    };

    console.log('📝 Creating post share message:', {
      hasPostData: !!postData,
      mediaCount: messageToCreate.media?.length || 0,
      hasImage: !!messageToCreate.image,
      hasVideo: !!messageToCreate.video
    });

    // Create message in MongoDB
    let message = await Message.create(messageToCreate);

    // Populate message
    message = await Message.findById(message._id)
      .populate('sender', 'name profilePicture firebaseUid')
      .populate('chat');

    // Update chat's latest message
    await Chat.findByIdAndUpdate(shareData.chat, {
      latestMessage: message._id,
      updatedAt: new Date()
    });

    // ✅ FORMAT FOR SOCKET EMISSION
    const formattedMessage = {
      _id: message._id,
      content: shareData.shareText || "Check this out!",
      sender: {
        _id: message.sender._id,
        firebaseUid: message.sender.firebaseUid,
        name: message.sender.name,
        profilePicture: message.sender.profilePicture
      },
      chat: message.chat._id,
      messageType: 'post',
      isPost: true,
      type: 'post',
      // Include ALL post data for frontend
      id: postData.id,
      postId: postData.id,
      postData: postData,
      media: postData.media || [],
      image: postData.image || postData.imageUrl || '',
      imageUrl: postData.image || postData.imageUrl || '',
      video: postData.video || '',
      authorId: postData.authorId,
      authorName: postData.authorName,
      authorAvatar: postData.authorAvatar,
      shareText: shareData.shareText,
      timestamp: new Date(),
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      status: 'sent'
    };

    console.log('✅ Post share created:', {
      messageId: message._id,
      chatId: shareData.chat,
      isPost: formattedMessage.isPost,
      mediaCount: formattedMessage.media?.length || 0
    });

    // ✅ EMIT TO SENDER FOR CONFIRMATION
    socket.emit('message_sent', {
      messageId: message._id,
      chatId: shareData.chat,
      status: 'sent',
      timestamp: new Date().toISOString(),
      isPost: true
    });

    // ✅ BROADCAST TO ALL USERS IN CHAT
    io.to(shareData.chat).emit('messageReceived', formattedMessage);
    
    // Also emit for backward compatibility
    io.to(shareData.chat).emit('new_message', formattedMessage);
    io.to(shareData.chat).emit('message', formattedMessage);
    
    console.log(`📡 Post broadcast to chat ${shareData.chat} with ${formattedMessage.media?.length || 0} media items`);

  } catch (error) {
    console.error('❌ [share_post] Error:', error);
    socket.emit('message_error', { 
      error: 'Failed to share post',
      details: error.message 
    });
  }
});

    // ✅ Compatible with 'new message' event (some clients might use this)
    socket.on('new message', async (messageData) => {
      // Forward to send_message handler
      socket.emit('send_message', messageData);
    });

    // ✅ Handle message sent confirmation from frontend
    socket.on('message_sent_confirmation', (data) => {
      console.log('✅ Message sent confirmation from frontend:', data.messageId);
      
      // Notify the sender with server ID
      socket.emit('message_sent', {
        messageId: data.messageId,
        chatId: data.chatId,
        status: 'sent',
        serverMessageId: data.serverMessageId || data.messageId,
        timestamp: new Date().toISOString()
      });
    });

    // ✅ Handle message delivered
    socket.on('message delivered', async (data) => {
      try {
        const { messageId, chatId } = data;
        
        console.log(`📬 Message delivered: ${messageId} by ${socket.firebaseUid}`);

        const message = await Message.findById(messageId);
        if (!message) {
          console.error(`❌ Message not found: ${messageId}`);
          return;
        }

        const user = await User.findOne({ firebaseUid: socket.firebaseUid });
        if (!user) return;

        if (!message.deliveredTo.includes(user._id)) {
          message.deliveredTo.push(user._id);
          
          if (message.deliveredTo.length > 0 && message.status !== 'read') {
            message.status = 'delivered';
          }
          
          await message.save();
        }

        // Notify sender
        const senderSockets = userSockets.get(message.sender.firebaseUid);
        if (senderSockets) {
          for (const senderSocketId of senderSockets) {
            const senderSocket = io.sockets.sockets.get(senderSocketId);
            if (senderSocket && senderSocket.connected) {
              senderSocket.emit('message_delivered', {
                messageId,
                chatId,
                deliveredTo: socket.firebaseUid,
                status: 'delivered',
                timestamp: new Date().toISOString()
              });
            }
          }
        }

        // Notify chat room
        io.to(chatId).emit('message delivered update', {
          messageId,
          deliveredTo: socket.firebaseUid,
          status: 'delivered',
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        console.error('❌ Error marking message as delivered:', error);
      }
    });

    // Handle message read status
    socket.on('message read', async (data) => {
      try {
        const { messageId, chatId, firebaseUid } = data;
        
        console.log(`📖 Message read: ${messageId} by ${firebaseUid}`);

        // Find user by Firebase UID
        const user = await User.findOne({ firebaseUid });
        if (!user) {
          throw new Error(`User not found for Firebase UID: ${firebaseUid}`);
        }

        const message = await Message.findById(messageId);
        if (!message) {
          console.error(`❌ Message not found: ${messageId}`);
          return;
        }

        // Check if user already marked as read
        if (!message.readBy.includes(user._id)) {
          message.readBy.push(user._id);
          message.status = 'read';
          await message.save();
        }

        // Notify the sender that message was read by this user
        const senderSockets = userSockets.get(message.sender.firebaseUid);
        if (senderSockets) {
          for (const senderSocketId of senderSockets) {
            const senderSocket = io.sockets.sockets.get(senderSocketId);
            if (senderSocket && senderSocket.connected) {
              senderSocket.emit('message_read', {
                messageId,
                chatId,
                readBy: firebaseUid,
                status: 'read',
                timestamp: new Date().toISOString()
              });
            }
          }
        }

        // Notify all users in the chat room
        io.to(chatId).emit('message read update', {
          messageId,
          readBy: firebaseUid,
          status: 'read',
          timestamp: new Date().toISOString()
        });

        console.log(`✅ Message ${messageId} marked as read by ${firebaseUid}`);
      } catch (error) {
        console.error('❌ Error marking message as read:', error);
      }
    });

    // In the all_messages_read handler, fix the query:
    socket.on('all_messages_read', async (data) => {
      try {
        const { chatId, firebaseUid } = data;
        
        console.log(`📚 [BULK READ REQUEST] Chat: ${chatId}, User: ${firebaseUid}`);

        // Find user by Firebase UID
        const user = await User.findOne({ firebaseUid });
        if (!user) {
          console.error(`❌ User not found: ${firebaseUid}`);
          return;
        }

        console.log(`🔍 User found: ${user._id}, Finding messages in chat: ${chatId}`);
        
        // ✅ FIXED: Use ObjectId for chat comparison
        const chatObjectId = new mongoose.Types.ObjectId(chatId);
        
        // Find messages that:
        // 1. Are in this chat
        // 2. Are NOT sent by this user
        // 3. Are NOT already read by this user
        const unreadMessages = await Message.find({
          chat: chatObjectId,  // ✅ Now using ObjectId
          sender: { $ne: user._id },
          readBy: { $ne: user._id }
        });
        
        console.log(`🔍 Found ${unreadMessages.length} unread messages for user ${user._id}`);
        
        if (unreadMessages.length === 0) {
          console.log('ℹ️ No unread messages to mark');
          return;
        }
        
        // Mark each message as read
        const updatePromises = unreadMessages.map(async (message) => {
          // Add user to readBy array if not already there
          if (!message.readBy.includes(user._id)) {
            message.readBy.push(user._id);
            
            // Update status to 'read'
            message.status = 'read';
            
            await message.save();
            return message._id;
          }
          return null;
        });
        
        const updatedMessageIds = (await Promise.all(updatePromises)).filter(id => id !== null);
        
        console.log(`✅ Marked ${updatedMessageIds.length} messages as read`);
        
        // Notify all users in the chat
        io.to(chatId).emit('all_messages_read', {
          chatId,
          readBy: firebaseUid,
          messageCount: updatedMessageIds.length,
          timestamp: new Date().toISOString()
        });
        
        // Also update individual message statuses for senders
        for (const messageId of updatedMessageIds) {
          const message = await Message.findById(messageId).populate('sender', 'firebaseUid');
          if (message && message.sender) {
            // Notify the sender specifically
            io.to(message.sender.firebaseUid).emit('message_read', {
              messageId: message._id,
              chatId,
              readBy: firebaseUid,
              status: 'read',
              timestamp: new Date().toISOString()
            });
          }
        }
        
      } catch (error) {
        console.error('❌ Error in all_messages_read:', error);
      }
    });

    // Handle typing events
    socket.on('typing', (data) => {
      try {
        const { chatId, userId } = data;
        console.log(`✍️ User ${userId} typing in chat: ${chatId}`);
        socket.to(chatId).emit('typing', {
          chatId,
          userId,
          userName: socket.userName,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('❌ Typing event error:', error);
      }
    });

    socket.on('stop typing', (data) => {
      try {
        const { chatId, userId } = data;
        console.log(`🛑 User ${userId} stopped typing in chat: ${chatId}`);
        socket.to(chatId).emit('stop typing', {
          chatId,
          userId,
          userName: socket.userName,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('❌ Stop typing event error:', error);
      }
    });

    // Handle user online status (manual from frontend)
    socket.on('user online', async (firebaseUid) => {
      try {
        console.log(`🟢 [manual] User online request: ${firebaseUid}`);
        const updatedUser = await updateUserStatus(firebaseUid, true, 'manual_online');
        
        if (updatedUser) {
          // Handle delayed delivery for this user
          await handleDelayedDelivery(firebaseUid);
        }
      } catch (error) {
        console.error('❌ Error updating online status:', error);
      }
    });

    // Handle user offline status (manual from frontend)
    socket.on('user offline', async (firebaseUid) => {
      try {
        console.log(`📴 [manual] User offline request: ${firebaseUid}`);
        await updateUserStatus(firebaseUid, false, 'manual_offline');
      } catch (error) {
        console.error('❌ Error updating offline status:', error);
      }
    });

  socket.on('disconnect', async () => {
  console.log('❌ User disconnected:', socket.id);
  
  const firebaseUid = socket.firebaseUid;
  if (!firebaseUid) return;
  
  // Get current connection count BEFORE removing
  const currentConnections = connectionTracker.getUserConnectionCount(firebaseUid);
  
  // Remove from tracker
  const remainingConnections = connectionTracker.removeConnection(socket.id);
  
  console.log(`📊 Connection stats for ${firebaseUid}: Before=${currentConnections}, After=${remainingConnections}`);
  
  // Always update lastSeen, but only mark offline if this was the last connection
  if (remainingConnections === 0) {
    console.log(`🚨 Last connection for ${firebaseUid}, marking offline`);
    await updateUserStatus(firebaseUid, false, 'disconnect_last');
  } else {
    console.log(`ℹ️ User ${firebaseUid} still has ${remainingConnections} active connection(s), keeping online`);
    // Just update lastSeen without changing online status
    await User.findOneAndUpdate(
      { firebaseUid },
      { 
        $set: { 
          lastSeen: new Date()
        }
      }
    );
  }
  // Clear heartbeat interval
  clearInterval(heartbeatInterval);
  
  // Remove from connected users
  const userInfo = connectedUsers.get(socket.id);
  connectedUsers.delete(socket.id);
  
  if (userInfo && userInfo.firebaseUid) {
    // Remove from user's socket tracking
    if (userSockets.has(userInfo.firebaseUid)) {
      userSockets.get(userInfo.firebaseUid).delete(socket.id);
      
      // If this was the user's LAST socket, clean up
      if (userSockets.get(userInfo.firebaseUid).size === 0) {
        userSockets.delete(userInfo.firebaseUid);
      }
    }
  }
});

    // Handle ping/pong for health checks
    socket.on('ping', (data) => {
      socket.emit('pong', {
        ...data,
        serverTime: new Date().toISOString(),
        connectionId: socket.id
      });
    });

    // Error handling
    socket.on('error', (error) => {
      console.error('❌ Socket error on', socket.id, ':', error);
    });
    
    // Connection stats (optional)
    socket.on('get_connection_stats', () => {
      socket.emit('connection_stats', {
        socketId: socket.id,
        connectedUsers: connectedUsers.size,
        userSockets: userSockets.size,
        totalConnections: io.engine.clientsCount,
        yourFirebaseUid: socket.firebaseUid,
        yourConnections: socket.firebaseUid ? getUserActiveConnections(socket.firebaseUid) : 0
      });
    });
  });
};

module.exports = configureSocket;