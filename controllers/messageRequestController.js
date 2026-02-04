const MessageRequest = require('../models/MessageRequest');
const Chat = require('../models/Chat');
const User = require('../models/User');
const Message = require('../models/Message');

// @desc    Send a message request to a user with private account
// @route   POST /api/chat/request
// @access  Private
const sendMessageRequest = async (req, res) => {
  try {
    const { receiverId, message, messageType = 'text', media } = req.body;
    
    console.log('📩 Sending message request from:', req.user._id, 'to Firebase UID:', receiverId);
    
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }
    
    if (!receiverId) {
      return res.status(400).json({
        success: false,
        message: 'Receiver ID (Firebase UID) is required'
      });
    }
    
    // Don't allow sending to yourself
    if (receiverId === req.user.firebaseUid) {
      return res.status(400).json({
        success: false,
        message: 'Cannot send message request to yourself'
      });
    }
    
    // ✅ FIX: Find receiver by Firebase UID, not MongoDB ObjectId
    const receiver = await User.findOne({ firebaseUid: receiverId });
    if (!receiver) {
      return res.status(404).json({
        success: false,
        message: 'Receiver not found'
      });
    }
    
    console.log('✅ Receiver found:', {
      mongoId: receiver._id,
      firebaseUid: receiver.firebaseUid,
      name: receiver.name
    });
    
    // Check for existing chat between users
    const existingChat = await Chat.findOne({
      isGroupChat: false,
      users: { $all: [req.user._id, receiver._id] } // Use MongoDB IDs here
    });
    
    // Check if there's already a pending request
    const existingRequest = await MessageRequest.findOne({
      sender: req.user._id,
      receiver: receiver._id, // Use MongoDB ID here
      status: 'pending'
    });
    
    if (existingRequest) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending message request with this user'
      });
    }
    
    // Check if there's an accepted request (chat already exists)
    if (existingChat) {
      const existingAcceptedRequest = await MessageRequest.findOne({
        chat: existingChat._id,
        status: 'accepted'
      });
      
      if (existingAcceptedRequest) {
        return res.status(400).json({
          success: false,
          message: 'You already have an active chat with this user'
        });
      }
    }
    
    // Create a chat for this request
    let chat;
    if (existingChat) {
      chat = existingChat;
      // Update chat to be a pending request
      chat.isPendingRequest = true;
      chat.isActiveChat = false;
      chat.requestInitiator = req.user._id;
      chat.requestSentAt = new Date();
      await chat.save();
    } else {
      chat = await Chat.create({
        chatName: 'sender',
        isGroupChat: false,
        users: [req.user._id, receiver._id], // Use MongoDB IDs here
        isPendingRequest: true,
        isActiveChat: false,
        requestInitiator: req.user._id,
        requestSentAt: new Date()
      });
    }
    
    // Create message request record
    const messageRequest = await MessageRequest.create({
      chat: chat._id,
      sender: req.user._id,
      receiver: receiver._id, // Use MongoDB ID here
      initialMessage: message || "Hi there! I'd like to message you.",
      messageType,
      media: media || undefined,
      status: 'pending'
    });
    
    // Create the initial message in the chat
    const initialMessage = await Message.create({
      sender: req.user._id,
      content: message || "Hi there! I'd like to message you.",
      chat: chat._id,
      messageType,
      media: media || undefined,
      isRequestMessage: true
    });
    
    // Update chat with latest message
    chat.latestMessage = initialMessage._id;
    await chat.save();
    
    // Populate response
    const populatedRequest = await MessageRequest.findById(messageRequest._id)
      .populate('sender', 'name email profilePicture firebaseUid')
      .populate('receiver', 'name email profilePicture firebaseUid')
      .populate('chat');
    
    console.log('✅ Message request sent successfully:', {
      requestId: messageRequest._id,
      chatId: chat._id,
      sender: req.user.name,
      receiver: receiver.name
    });
    
    res.status(201).json({
      success: true,
      message: 'Message request sent successfully',
      data: populatedRequest
    });
    
  } catch (error) {
    console.error('❌ Send message request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send message request',
      error: error.message
    });
  }
};

// @desc    Get all pending message requests for current user
// @route   GET /api/chat/requests
// @access  Private
const getMessageRequests = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }
    
    console.log('📩 Fetching message requests for user:', req.user._id);
    
    const messageRequests = await MessageRequest.findPendingRequests(req.user._id);
    
    console.log(`✅ Found ${messageRequests.length} pending requests`);
    
    res.json({
      success: true,
      data: messageRequests,
      count: messageRequests.length
    });
    
  } catch (error) {
    console.error('❌ Get message requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch message requests',
      error: error.message
    });
  }
};

// @desc    Accept a message request
// @route   POST /api/chat/requests/:requestId/accept
// @access  Private
const acceptMessageRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    
    console.log('✅ Accepting message request:', requestId);
    
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }
    
    // Find the request
    const messageRequest = await MessageRequest.findById(requestId)
      .populate('sender', 'name email profilePicture firebaseUid')
      .populate('receiver', 'name email profilePicture firebaseUid')
      .populate('chat');
    
    if (!messageRequest) {
      return res.status(404).json({
        success: false,
        message: 'Message request not found'
      });
    }
    
    // Verify current user is the receiver
    if (messageRequest.receiver._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to accept this request'
      });
    }
    
    // Verify request is still pending
    if (messageRequest.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `This request is already ${messageRequest.status}`
      });
    }
    
    // Accept the request
    await messageRequest.accept();
    
    // Update the chat
    const chat = await Chat.findByIdAndUpdate(
      messageRequest.chat._id,
      {
        isPendingRequest: false,
        isActiveChat: true,
        requestAcceptedAt: new Date()
      },
      { new: true }
    )
    .populate('users', 'name email profilePicture firebaseUid');
    
    // Send an auto-response message
    const welcomeMessage = await Message.create({
      sender: req.user._id,
      content: `Hi! I've accepted your message request. Let's chat!`,
      chat: chat._id,
      messageType: 'text'
    });
    
    // Update chat latest message
    chat.latestMessage = welcomeMessage._id;
    await chat.save();
    
    console.log('✅ Message request accepted:', requestId);
    
    // Emit socket events for real-time updates
    // io.to(messageRequest.sender.firebaseUid).emit('message_request_accepted', {
    //   requestId,
    //   chat: chat,
    //   acceptedBy: req.user
    // });
    
    res.json({
      success: true,
      message: 'Message request accepted successfully',
      data: {
        request: messageRequest,
        chat: chat,
        welcomeMessage: welcomeMessage
      }
    });
    
  } catch (error) {
    console.error('❌ Accept message request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to accept message request',
      error: error.message
    });
  }
};

// @desc    Reject a message request
// @route   POST /api/chat/requests/:requestId/reject
// @access  Private
const rejectMessageRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { reason, customMessage } = req.body;
    
    console.log('❌ Rejecting message request:', requestId);
    
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }
    
    // Find the request
    const messageRequest = await MessageRequest.findById(requestId)
      .populate('sender', 'name email profilePicture firebaseUid')
      .populate('receiver', 'name email profilePicture firebaseUid');
    
    if (!messageRequest) {
      return res.status(404).json({
        success: false,
        message: 'Message request not found'
      });
    }
    
    // Verify current user is the receiver
    if (messageRequest.receiver._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to reject this request'
      });
    }
    
    // Verify request is still pending
    if (messageRequest.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `This request is already ${messageRequest.status}`
      });
    }
    
    // Reject the request
    await messageRequest.reject(reason, customMessage);
    
    // Optional: Send rejection notification (if you want to notify sender)
    // const rejectionMessage = await Message.create({
    //   sender: req.user._id,
    //   content: customMessage || `Your message request has been declined.`,
    //   chat: messageRequest.chat,
    //   messageType: 'text',
    //   isSystemMessage: true
    // });
    
    console.log('✅ Message request rejected:', requestId);
    
    // Emit socket event
    // io.to(messageRequest.sender.firebaseUid).emit('message_request_rejected', {
    //   requestId,
    //   rejectedBy: req.user,
    //   reason: reason || 'not_interested'
    // });
    
    res.json({
      success: true,
      message: 'Message request rejected successfully',
      data: {
        request: messageRequest,
        reason: reason || 'not_interested'
      }
    });
    
  } catch (error) {
    console.error('❌ Reject message request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject message request',
      error: error.message
    });
  }
};

// @desc    Withdraw a sent message request
// @route   POST /api/chat/requests/:requestId/withdraw
// @access  Private
const withdrawMessageRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    
    console.log('↩️ Withdrawing message request:', requestId);
    
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }
    
    // Find the request
    const messageRequest = await MessageRequest.findById(requestId)
      .populate('sender', 'name email profilePicture firebaseUid')
      .populate('receiver', 'name email profilePicture firebaseUid');
    
    if (!messageRequest) {
      return res.status(404).json({
        success: false,
        message: 'Message request not found'
      });
    }
    
    // Verify current user is the sender
    if (messageRequest.sender._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to withdraw this request'
      });
    }
    
    // Verify request is still pending
    if (messageRequest.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot withdraw a request that is already ${messageRequest.status}`
      });
    }
    
    // Withdraw the request
    await messageRequest.withdraw();
    
    console.log('✅ Message request withdrawn:', requestId);
    
    // Emit socket event
    // io.to(messageRequest.receiver.firebaseUid).emit('message_request_withdrawn', {
    //   requestId,
    //   withdrawnBy: req.user
    // });
    
    res.json({
      success: true,
      message: 'Message request withdrawn successfully',
      data: {
        request: messageRequest
      }
    });
    
  } catch (error) {
    console.error('❌ Withdraw message request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to withdraw message request',
      error: error.message
    });
  }
};

// @desc    Mark message requests as read
// @route   POST /api/chat/requests/mark-read
// @access  Private
const markMessageRequestsAsRead = async (req, res) => {
  try {
    const { requestIds } = req.body; // Array of request IDs
    
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }
    
    console.log('📖 Marking message requests as read:', requestIds?.length || 'all');
    
    let query;
    if (requestIds && Array.isArray(requestIds) && requestIds.length > 0) {
      query = { 
        _id: { $in: requestIds },
        receiver: req.user._id,
        isRead: false 
      };
    } else {
      // Mark all unread requests for this user as read
      query = { 
        receiver: req.user._id,
        isRead: false,
        status: 'pending'
      };
    }
    
    const result = await MessageRequest.updateMany(
      query,
      { $set: { isRead: true, updatedAt: Date.now() } }
    );
    
    console.log(`✅ Marked ${result.modifiedCount} message requests as read`);
    
    res.json({
      success: true,
      message: `Marked ${result.modifiedCount} message requests as read`,
      data: {
        modifiedCount: result.modifiedCount
      }
    });
    
  } catch (error) {
    console.error('❌ Mark message requests as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark message requests as read',
      error: error.message
    });
  }
};

// @desc    Get message request counts
// @route   GET /api/chat/requests/count
// @access  Private
const getMessageRequestCounts = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }
    
    const counts = await MessageRequest.getRequestCounts(req.user._id);
    
    res.json({
      success: true,
      data: counts
    });
    
  } catch (error) {
    console.error('❌ Get message request counts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get message request counts',
      error: error.message
    });
  }
};

// @desc    Check if there's a pending request between users
// @route   GET /api/chat/requests/check/:userId
// @access  Private
const checkMessageRequest = async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }
    
    // Check both directions
    const pendingRequest = await MessageRequest.findOne({
      $or: [
        { sender: req.user._id, receiver: userId, status: 'pending' },
        { sender: userId, receiver: req.user._id, status: 'pending' }
      ]
    })
    .populate('sender', 'name profilePicture firebaseUid')
    .populate('receiver', 'name profilePicture firebaseUid')
    .populate('chat');
    
    res.json({
      success: true,
      data: pendingRequest,
      exists: !!pendingRequest,
      isSender: pendingRequest ? 
        pendingRequest.sender._id.toString() === req.user._id.toString() : 
        false
    });
    
  } catch (error) {
    console.error('❌ Check message request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check message request',
      error: error.message
    });
  }
};

// @desc    Get sent message requests
// @route   GET /api/chat/requests/sent
// @access  Private
const getSentMessageRequests = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }
    
    const sentRequests = await MessageRequest.findSentRequests(req.user._id);
    
    res.json({
      success: true,
      data: sentRequests,
      count: sentRequests.length
    });
    
  } catch (error) {
    console.error('❌ Get sent message requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sent message requests',
      error: error.message
    });
  }
};

// @desc    Clear all rejected/withdrawn requests (cleanup)
// @route   DELETE /api/chat/requests/cleanup
// @access  Private
const cleanupMessageRequests = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }
    
    // Delete requests that are not pending and older than 7 days
    const cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const result = await MessageRequest.deleteMany({
      $or: [
        { sender: req.user._id },
        { receiver: req.user._id }
      ],
      status: { $in: ['rejected', 'withdrawn'] },
      updatedAt: { $lt: cutoffDate }
    });
    
    console.log(`🧹 Cleaned up ${result.deletedCount} old message requests`);
    
    res.json({
      success: true,
      message: `Cleaned up ${result.deletedCount} old message requests`,
      data: {
        deletedCount: result.deletedCount
      }
    });
    
  } catch (error) {
    console.error('❌ Cleanup message requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup message requests',
      error: error.message
    });
  }
};

module.exports = {
  sendMessageRequest,
  getMessageRequests,
  acceptMessageRequest,
  rejectMessageRequest,
  withdrawMessageRequest,
  markMessageRequestsAsRead,
  getMessageRequestCounts,
  checkMessageRequest,
  getSentMessageRequests,
  cleanupMessageRequests
};