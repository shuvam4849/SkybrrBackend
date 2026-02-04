const express = require('express');
const router = express.Router();
const User = require('../models/User');

// Simple auth middleware without separate file
const protect = async (req, res, next) => {
  try {
    let token;

    // Get token from header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route'
      });
    }

    try {
      // ✅ Use Firebase Admin from request (passed by main server)
      if (!req.firebaseAdmin || !req.firebaseAdmin.getAuth) {
        return res.status(500).json({
          success: false,
          message: 'Firebase not initialized'
        });
      }
      
      const auth = req.firebaseAdmin.getAuth();
      const decodedToken = await auth.verifyIdToken(token);
      
      // Find or create user in MongoDB
      let user = await User.findOne({ firebaseUid: decodedToken.uid });
      
      if (!user) {
        // Get user info from Firebase
        const firebaseUser = await auth.getUser(decodedToken.uid);
        
        user = await User.create({
          firebaseUid: decodedToken.uid,
          name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'User',
          email: firebaseUser.email || `${decodedToken.uid}@unknown.com`,
          profilePicture: firebaseUser.photoURL || null,
          isOnline: false,
          lastSeen: new Date()
        });
      }
      
      req.user = user;
      next();
      
    } catch (error) {
      console.error('Token verification error:', error);
      
      if (error.code === 'auth/id-token-expired') {
        return res.status(401).json({
          success: false,
          message: 'Token expired. Please log in again.'
        });
      }
      
      return res.status(401).json({
        success: false,
        message: 'Not authorized. Invalid token.'
      });
    }
    
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server authentication error'
    });
  }
};

// Import controller functions
const {
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
} = require('../controllers/messageRequestController');

// All routes require authentication
router.use(protect);

// Send a message request
router.post('/request', sendMessageRequest);

// Get all pending message requests for current user
router.get('/requests', getMessageRequests);

// Get sent message requests
router.get('/requests/sent', getSentMessageRequests);

// Get message request counts
router.get('/requests/count', getMessageRequestCounts);

// Check if there's a pending request between users
router.get('/requests/check/:userId', checkMessageRequest);

// Accept a message request
router.post('/requests/:requestId/accept', acceptMessageRequest);

// Reject a message request
router.post('/requests/:requestId/reject', rejectMessageRequest);

// Withdraw a sent message request
router.post('/requests/:requestId/withdraw', withdrawMessageRequest);

// Mark message requests as read
router.post('/requests/mark-read', markMessageRequestsAsRead);

// Cleanup old message requests
router.delete('/requests/cleanup', cleanupMessageRequests);

module.exports = router;