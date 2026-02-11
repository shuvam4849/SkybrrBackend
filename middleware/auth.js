const User = require('../models/User');

// Authentication middleware
const protect = async (req, res, next) => {
  try {
    let token;

    // Get token from header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      console.log('❌ No token provided');
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route'
      });
    }

    try {
      // ✅ Use Firebase Admin from request (passed by main server)
      if (!req.firebaseAdmin || !req.firebaseAdmin.getAuth) {
        console.log('❌ Firebase Admin not available in request');
        return res.status(500).json({
          success: false,
          message: 'Authentication service not available'
        });
      }
      
      const auth = req.firebaseAdmin.getAuth();
      const decodedToken = await auth.verifyIdToken(token);
      console.log('✅ Firebase token verified for user:', decodedToken.uid);
      
 // Find user by Firebase UID
let user = await User.findOne({ firebaseUid: decodedToken.uid });

if (!user) {
  console.log('👤 Creating new user in backend database');
  
  try {
    // Get user info from Firebase
    const firebaseUser = await auth.getUser(decodedToken.uid);
    
    // Check what auth method was used
    let email = null;
    let phone = null;
    
    if (firebaseUser.email) {
      // User registered with email
      email = firebaseUser.email;
      phone = null;
    } else {
      // User registered with phone
      email = null;
      // Extract phone from Firebase (might be in phoneNumber field)
      phone = firebaseUser.phoneNumber || null;
    }
    
    // Check if user already exists with this email/phone
    let existingUser = null;
    if (email) {
      existingUser = await User.findOne({ email });
    } else if (phone) {
      existingUser = await User.findOne({ phone });
    }
    
    if (existingUser) {
      // Update existing user with firebaseUid
      existingUser.firebaseUid = decodedToken.uid;
      await existingUser.save();
      user = existingUser;
      console.log('✅ Updated existing user with Firebase UID');
    } else {
      // Create new user
      user = await User.create({
        firebaseUid: decodedToken.uid,
        name: firebaseUser.displayName || 'User',
        email: email,
        phone: phone,
        profilePicture: firebaseUser.photoURL || null,
        isOnline: false,
        lastSeen: new Date(),
        authMethod: email ? 'email' : (phone ? 'phone' : 'unknown')
      });
      console.log('✅ Created new user with', email ? 'email' : 'phone');
    }
    
  } catch (error) {
    console.error('❌ Error creating user:', error.message);
    
    if (error.code === 11000) {
      console.log('🔄 Duplicate key error - user might already exist');
      user = await User.findOne({ firebaseUid: decodedToken.uid });
      
      if (!user) {
        // Emergency: Create minimal user
        user = await User.create({
          firebaseUid: decodedToken.uid,
          name: 'User',
          // Don't set email or phone to avoid duplicates
          isOnline: false,
          lastSeen: new Date()
        });
        console.log('🚨 Created minimal user without email/phone');
      }
    } else {
      throw error;
    }
  }
} else {
  console.log('✅ Existing user found:', user._id);
}

req.user = user;
next();
      
      req.user = user;
      console.log('🔐 User set in request:', req.user._id);
      next();
      
    } catch (error) {
      console.error('❌ Token verification error:', error);
      
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
    console.error('❌ Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server authentication error'
    });
  }
};

// Admin middleware (optional)
const adminProtect = async (req, res, next) => {
  await protect(req, res, () => {
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required.'
      });
    }
    next();
  });
};

module.exports = {
  protect,
  adminProtect
};