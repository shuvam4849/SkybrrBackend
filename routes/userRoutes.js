const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { firebaseProtect } = require('../middleware/firebaseAuth');

// @desc    Get user by Firebase UID (FULL user data)
// @route   GET /api/user/:firebaseUid
// @access  Private
router.get('/:firebaseUid', firebaseProtect, async (req, res) => {
  try {
    const { firebaseUid } = req.params;
    
    console.log('👤 Fetching FULL user by Firebase UID:', firebaseUid);
    
    const user = await User.findOne({ firebaseUid })
      .select('isOnline lastSeen name profilePicture email firebaseUid');
    
    if (!user) {
      console.log('❌ User not found:', firebaseUid);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    console.log('✅ FULL User found:', {
      name: user.name,
      isOnline: user.isOnline,
      lastSeen: user.lastSeen
    });
    
    res.json({
      success: true,
      user: {
        firebaseUid: user.firebaseUid,
        isOnline: user.isOnline,
        lastSeen: user.lastSeen,
        name: user.name,
        profilePicture: user.profilePicture,
        email: user.email
      }
    });
    
  } catch (error) {
    console.error('❌ Error fetching full user:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching user',
      error: error.message
    });
  }
});

// @desc    Get user status only
// @route   GET /api/user/:firebaseUid/status
// @access  Private
router.get('/:firebaseUid/status', firebaseProtect, async (req, res) => {
  try {
    const { firebaseUid } = req.params;
    
    console.log('📊 Fetching user STATUS for:', firebaseUid);
    
    const user = await User.findOne({ firebaseUid })
      .select('isOnline lastSeen name');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // ✅ DEBUG: Log what's actually in the database
    console.log('📊 DATABASE DATA:', {
      isOnline: user.isOnline,
      lastSeen: user.lastSeen,
      lastSeenType: typeof user.lastSeen,
      lastSeenRaw: user.lastSeen,
      lastSeenISO: user.lastSeen?.toISOString?.()
    });
    
    // ✅ FIX: Better status text formatting
    const getStatusText = () => {
      if (user.isOnline) return 'Online';
      
      if (!user.lastSeen || user.lastSeen === null) {
        console.log('⚠️ lastSeen is null for offline user');
        return 'Offline';
      }
      
      // Format lastSeen
      const now = new Date();
      const lastSeenDate = new Date(user.lastSeen);
      const diffMs = now - lastSeenDate;
      const diffMin = Math.floor(diffMs / 60000);
      
      if (diffMin < 1) return 'Last seen just now';
      if (diffMin < 60) return `Last seen ${diffMin} minute${diffMin > 1 ? 's' : ''} ago`;
      
      const diffHour = Math.floor(diffMin / 60);
      if (diffHour < 24) return `Last seen ${diffHour} hour${diffHour > 1 ? 's' : ''} ago`;
      
      return `Last seen ${lastSeenDate.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
    };
    
    const statusText = getStatusText();
    
    res.json({
      success: true,
      data: {
        firebaseUid: user.firebaseUid,
        isOnline: user.isOnline,
        lastSeen: user.lastSeen,
        name: user.name,
        statusText: statusText
      }
    });
    
  } catch (error) {
    console.error('❌ Error fetching user status:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching user status',
      error: error.message
    });
  }
});

// Add to userRoutes.js
router.post('/force-update-last-seen/:firebaseUid', async (req, res) => {
  try {
    const user = await User.findOneAndUpdate(
      { firebaseUid: req.params.firebaseUid },
      { 
        $set: { 
          lastSeen: new Date(),
          isOnline: false
        }
      },
      { new: true }
    );
    
    res.json({
      success: true,
      message: 'lastSeen updated',
      user: {
        name: user.name,
        lastSeen: user.lastSeen,
        isOnline: user.isOnline
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;