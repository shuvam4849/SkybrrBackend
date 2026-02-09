const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const firebaseAdmin = require('../config/firebase-admin'); // ✅ USE SHARED MODULE

// ============================================
// UPDATED: FETCH USER DATA FROM FIRESTORE (ROOT-LEVEL FIELDS)
// ============================================
const fetchUserFromFirestore = async (firebaseUid) => {
  try {
    console.log('🔥 Fetching user data from Firestore for:', firebaseUid);
    
    // ✅ Use shared Firebase module
    const firestore = firebaseAdmin.getFirestore();
    if (!firestore) {
      console.log('❌ Firebase Firestore not available');
      return null;
    }
    
    const userDoc = await firestore.collection('users').doc(firebaseUid).get();
    
    if (!userDoc.exists) {
      console.log('📭 No Firestore document found for user');
      return null;
    }
    
    const userData = userDoc.data();
    console.log('📥 Firestore user data available:', Object.keys(userData));
    
    // 🔥 CRITICAL: Check for ROOT-LEVEL fields first (new structure)
    console.log('🔍 Checking for root-level fields...');
    
    // Get username (SINGLE username field)
    const username = userData.username || '';
    
    // Get name from root-level fields (NEW STRUCTURE)
    let name = '';
    
    // 1. Check firstName + lastName at ROOT level
    if (userData.firstName || userData.lastName) {
      name = `${userData.firstName || ''} ${userData.lastName || ''}`.trim();
      console.log('✅ Got name from firstName/lastName (root):', name);
    }
    // 2. Check profileName at ROOT level
    else if (userData.profileName) {
      name = userData.profileName;
      console.log('✅ Got name from profileName (root):', name);
    }
    // 3. Check username at ROOT level
    else if (username) {
      name = username;
      console.log('✅ Got name from username (root):', name);
    }
    // 4. Check LEGACY nested profile.firstName/profile.lastName
    else if (userData.profile) {
      const profile = userData.profile;
      if (profile.firstName || profile.lastName) {
        name = `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
        console.log('🔄 Got name from legacy profile object:', name);
      } else if (profile.profileName) {
        name = profile.profileName;
        console.log('🔄 Got name from legacy profile.profileName:', name);
      }
    }
    // 5. Fallback to email
    else if (userData.email) {
      const emailName = userData.email.split('@')[0];
      name = emailName
        .split(/[._]/)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
      console.log('📧 Created name from email:', name);
    } else {
      name = `User_${firebaseUid.substring(0, 6)}`;
    }
    
    // Get email
    const email = userData.email || '';
    
    // Get profile picture - check ROOT level avatar first
    let profilePicture = '';
    
    // Check root-level avatar field first (NEW STRUCTURE)
    if (userData.avatar && typeof userData.avatar === 'string' && userData.avatar.trim() !== '') {
      profilePicture = userData.avatar.trim();
      console.log('✅ Got avatar from root-level avatar field');
    }
    // Check legacy nested profile.avatar
    else if (userData.profile?.avatar && typeof userData.profile.avatar === 'string') {
      profilePicture = userData.profile.avatar.trim();
      console.log('🔄 Got avatar from legacy profile.avatar');
    }
    // Check other possible fields
    else {
      const possibleAvatarFields = [
        userData.profilePicture,
        userData.profileImage,
        userData.photoURL,
        userData.profile?.profilePicture,
        userData.profile?.profileImage
      ];
      
      for (const field of possibleAvatarFields) {
        if (field && typeof field === 'string' && field.trim() !== '') {
          profilePicture = field.trim();
          console.log('✅ Got profile picture from fallback field');
          break;
        }
      }
    }
    
    // Get additional profile data from root level
    const bio = userData.bio || '';
    const isPrivate = userData.isPrivate || false;
    const website = userData.website || '';
    const gender = userData.gender || '';
    
    // Get preferences
    const preferences = userData.preferences || {};
    
    // Get system flags
    const profileCompleted = userData.profileCompleted || false;
    const preferencesCompleted = userData.preferencesCompleted || false;
    const registrationCompleted = userData.registrationCompleted || false;
    
    // In fetchUserFromFirestore function, update the return statement:

return {
  name,
  username,
  email,
  profilePicture,
  
  // ✅ ADD THESE: Pass root-level fields directly
  firstName: userData.firstName || '',
  lastName: userData.lastName || '',
  middleName: userData.middleName || '',
  bio: userData.bio || '',
  isPrivate: userData.isPrivate || false,
  website: userData.website || '',
  gender: userData.gender || '',
  phone: userData.phone || undefined, // Keep as undefined if empty
  
  // ✅ ADD THESE SYSTEM FLAGS:
  profileCompleted: userData.profileCompleted || false,
  preferencesCompleted: userData.preferencesCompleted || false,
  registrationCompleted: userData.registrationCompleted || false,
  onboardingCompleted: userData.onboardingCompleted || false,
  
  // Preferences
  preferences: userData.preferences || {},
  
  // Keep full data for debugging
  firestoreData: userData
};
    
  } catch (error) {
    console.error('❌ Error fetching from Firestore:', error.message);
    return null;
  }
};

router.post('/resync-all-users', async (req, res) => {
  try {
    console.log('🔄 Force resyncing all users from Firestore...');
    
    // ✅ Use shared Firebase module
    const firestore = firebaseAdmin.getFirestore();
    if (!firestore) {
      return res.status(500).json({
        success: false,
        message: 'Firebase Firestore not available'
      });
    }
    
    const usersSnapshot = await firestore.collection('users').get();
    console.log(`📊 Found ${usersSnapshot.size} users in Firestore`);
    
    let syncedCount = 0;
    let errors = [];
    
    // 2. Resync each user to MongoDB
    for (const doc of usersSnapshot.docs) {
      try {
        const userData = doc.data();
        const firebaseUid = doc.id;
        
        console.log(`📥 Resyncing user: ${firebaseUid}`, {
          firestoreRegistrationCompleted: userData.registrationCompleted,
          firestoreUsername: userData.username
        });
        
        // 3. Find or create user in MongoDB
        const updateData = {
          firebaseUid: firebaseUid,
          username: userData.username || '',
          name: userData.firstName && userData.lastName 
            ? `${userData.firstName} ${userData.lastName}` 
            : userData.username || `User_${firebaseUid.substring(0, 6)}`,
          firstName: userData.firstName || '',
          lastName: userData.lastName || '',
          email: userData.email || `${firebaseUid}@skybrr.com`,
          profilePicture: userData.avatar || '',
          bio: userData.bio || '',
          isPrivate: userData.isPrivate || false,
          website: userData.website || '',
          gender: userData.gender || '',
          phone: userData.phone || undefined,
          preferences: userData.preferences || {
            emailNotifications: true,
            pushNotifications: true,
            privateAccount: userData.isPrivate || false,
            showActivityStatus: true,
            allowTagging: true,
            allowComments: true,
            allowSharing: true,
            allowMessagesFromEveryone: true,
            allowStoryReplies: true,
            saveOriginalPhotos: true,
            autoPlayVideos: true,
            dataSaverMode: false,
            darkMode: false
          },
          profileCompleted: userData.profileCompleted || true,
          preferencesCompleted: userData.preferencesCompleted || true,
          registrationCompleted: userData.registrationCompleted || true, // ✅ IMPORTANT
          onboardingCompleted: userData.onboardingCompleted || true,
          firstLogin: userData.firstLogin !== undefined ? userData.firstLogin : false,
          status: 'Hey there! I am using WhatsApp Clone',
          isOnline: false,
          lastSeen: new Date(),
          lastSynced: new Date(),
          firestoreData: userData
        };
        
        // 4. Update MongoDB
        await User.findOneAndUpdate(
          { firebaseUid },
          { $set: updateData },
          { 
            upsert: true, 
            new: true,
            setDefaultsOnInsert: true 
          }
        );
        
        syncedCount++;
        console.log(`✅ Resynced: ${firebaseUid} (${syncedCount}/${usersSnapshot.size})`);
        
      } catch (userError) {
        console.error(`❌ Error resyncing user ${doc.id}:`, userError.message);
        errors.push({ userId: doc.id, error: userError.message });
      }
    }
    
    res.json({
      success: true,
      message: `Resynced ${syncedCount} users from Firestore to MongoDB`,
      syncedCount,
      errorCount: errors.length,
      errors: errors.slice(0, 10) // Show first 10 errors
    });
    
  } catch (error) {
    console.error('❌ Resync error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/*
// ============================================
// SIMPLE TOKEN EXTRACTION (FIXED)
// ============================================
const extractUserFromToken = (req, res, next) => {
  try {
    console.log('\n🔐 === TOKEN EXTRACTION ===');
    
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('⚠️ No Bearer token found');
      req.user = null;
      return next();
    }
    
    const token = authHeader.split(' ')[1];
    console.log('📌 Token received, length:', token.length);
    
    try {
      // Decode the token without verification
      const decoded = jwt.decode(token);
      
      if (!decoded) {
        console.log('❌ Failed to decode token');
        req.user = null;
        return next();
      }
      
      console.log('✅ Token decoded successfully');
      
      // Store basic info for now
      req.user = {
        firebaseUid: decoded.user_id || decoded.sub || decoded.uid,
        token: token,
        decoded: decoded
      };
      
      next();
      
    } catch (decodeError) {
      console.log('❌ Token decode error:', decodeError.message);
      req.user = null;
      next();
    }
    
  } catch (error) {
    console.error('❌ Token extraction error:', error);
    req.user = null;
    next();
  }
}; */

// In routes/auth.js, replace extractUserFromToken function:

const extractUserFromToken = async (req, res, next) => {
  try {
    console.log('\n🔐 === TOKEN EXTRACTION & VERIFICATION ===');
    
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('⚠️ No Bearer token found');
      req.user = null;
      return next();
    }
    
    const token = authHeader.split(' ')[1];
    console.log('📌 Token received, length:', token.length);
    
    try {
      // ✅ VERIFY token with Firebase (not just decode)
      if (!req.firebaseAdmin || !req.firebaseAdmin.getAuth) {
        console.log('❌ Firebase Auth not available');
        req.user = null;
        return next();
      }
      
      const auth = req.firebaseAdmin.getAuth();
      const decodedToken = await auth.verifyIdToken(token);
      
      console.log('✅ Token verified successfully for user:', decodedToken.uid);
      
      // Find or create user in MongoDB
      const User = require('../models/User');
      let user = await User.findOne({ firebaseUid: decodedToken.uid });
      
      if (!user) {
        // Create minimal user if not exists
        user = await User.create({
          firebaseUid: decodedToken.uid,
          name: decodedToken.name || decodedToken.email?.split('@')[0] || 'User',
          email: decodedToken.email || `${decodedToken.uid}@skybrr.com`,
          profilePicture: decodedToken.picture || null,
          isOnline: false,
          lastSeen: new Date()
        });
        console.log('✅ Created new user during token verification');
      }
      
      req.user = user;
      next();
      
    } catch (verifyError) {
      console.log('❌ Token verification failed:', verifyError.message);
      req.user = null;
      next();
    }
    
  } catch (error) {
    console.error('❌ Token extraction error:', error);
    req.user = null;
    next();
  }
};

// ============================================
// SYNC USER (WITH FIRESTORE FETCH)
// ============================================
const syncUserFromToken = async (req, res) => {
  try {
    console.log('\n🔄 === SYNC FROM TOKEN START ===');
    
    // Get token from request
    const token = req.user?.token;
    const decoded = req.user?.decoded;
    
    if (!token || !decoded) {
      console.log('❌ No valid token data');
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }
    
    const firebaseUid = decoded.user_id || decoded.sub || decoded.uid;
    
    if (!firebaseUid) {
      console.log('❌ No firebaseUid in token');
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid token' 
      });
    }
    
    console.log('📥 Firebase UID from token:', firebaseUid);
    
    // 1. FIRST TRY TO GET DATA FROM FIRESTORE
    console.log('🔥 Attempting Firestore fetch...');
    const firestoreData = await fetchUserFromFirestore(firebaseUid);
    
    let name, email, profilePicture;
    
    if (firestoreData && firestoreData.name) {
      // Use Firestore data (most accurate)
      name = firestoreData.name;
      email = firestoreData.email;
      profilePicture = firestoreData.profilePicture;
      console.log('✅ Using Firestore data');
    } else {
      // 2. FALLBACK TO TOKEN DATA
      console.log('🔄 No Firestore data, using token data');
      email = decoded.email;
      
      // Try to create name from email
      if (email && email.includes('@')) {
        const emailName = email.split('@')[0];
        name = emailName
          .split(/[._]/)
          .map(part => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' ');
        console.log('📧 Created name from email:', name);
      } else {
        name = `User_${firebaseUid.substring(0, 6)}`;
      }
      
      profilePicture = '';
    }
    
    console.log('📋 Final user data to sync:', {
      firebaseUid,
      name,
      email: email?.substring(0, 20) + '...',
      hasProfilePicture: !!profilePicture
    });
    
    // In syncUserFromToken function, replace the save section:

// 3. SAVE TO MONGODB WITH FULL DATA
let user;

try {
  // In your auth routes file, update the syncUserFromToken function:

const updateData = {
  // Core identity
  firebaseUid: firebaseUid,
  
  // Profile info from Firestore
  username: firestoreData?.username || '',
  name: name || `User_${firebaseUid.substring(0, 6)}`,
  firstName: firestoreData?.firstName || '',
  lastName: firestoreData?.lastName || '',
  middleName: firestoreData?.middleName || '',
  email: email || `${firebaseUid}@skybrr.com`,
  
  // Profile details
  profilePicture: profilePicture || '',
  bio: firestoreData?.bio || '',
  isPrivate: firestoreData?.isPrivate || false,
  website: firestoreData?.website || '',
  gender: firestoreData?.gender || '',
  phone: firestoreData?.phone || undefined,
  
  // Preferences
  preferences: firestoreData?.preferences || {
    emailNotifications: true,
    pushNotifications: true,
    privateAccount: firestoreData?.isPrivate || false,
    showActivityStatus: true,
    allowTagging: true,
    allowComments: true,
    allowSharing: true,
    allowMessagesFromEveryone: true,
    allowStoryReplies: true,
    saveOriginalPhotos: true,
    autoPlayVideos: true,
    dataSaverMode: false,
    darkMode: false
  },
  
  // System flags
  profileCompleted: firestoreData?.profileCompleted || false,
  preferencesCompleted: firestoreData?.preferencesCompleted || false,
  registrationCompleted: firestoreData?.registrationCompleted || false,
  onboardingCompleted: firestoreData?.onboardingCompleted || false,
  firstLogin: firestoreData?.firstLogin !== undefined ? firestoreData.firstLogin : true,
  
  // Status
  status: 'Hey there! I am using WhatsApp Clone',
  isOnline: true,
  lastSeen: new Date(),
  lastSynced: new Date(),
  
  // Reference
  firestoreData: firestoreData?.firestoreData || {}
};

console.log('📦 Saving to MongoDB:', {
  username: updateData.username,
  firstName: updateData.firstName,
  lastName: updateData.lastName,
  profileCompleted: updateData.profileCompleted,
  registrationCompleted: updateData.registrationCompleted
});

user = await User.findOneAndUpdate(
  { firebaseUid },
  { $set: updateData },
  { 
    upsert: true, 
    new: true,
    setDefaultsOnInsert: true 
  }
);
  
  console.log('✅ User saved successfully:', {
    id: user._id,
    username: user.username,
    name: user.name,
    email: user.email,
    profileCompleted: user.profileCompleted,
    registrationCompleted: user.registrationCompleted
  });
  
} catch (dbError) {
  console.error('❌ Database error:', dbError.message);
  
  // Handle duplicate errors
  if (dbError.code === 11000) {
    console.log('🔄 Handling duplicate entry...');
    
    // Try to find and update existing user
    user = await User.findOne({ firebaseUid });
    
    if (user) {
      user.name = name || user.name;
      user.username = firestoreData?.username || user.username;
      user.email = email || user.email;
      user.profilePicture = profilePicture || user.profilePicture;
      user.bio = firestoreData?.bio || user.bio;
      user.isPrivate = firestoreData?.isPrivate !== undefined ? firestoreData.isPrivate : user.isPrivate;
      user.preferences = firestoreData?.preferences || user.preferences;
      user.profileCompleted = firestoreData?.profileCompleted !== undefined ? firestoreData.profileCompleted : user.profileCompleted;
      user.registrationCompleted = firestoreData?.registrationCompleted !== undefined ? firestoreData.registrationCompleted : user.registrationCompleted;
      await user.save();
      console.log('✅ Updated existing user with new data');
    } else {
      throw dbError;
    }
  } else {
    throw dbError;
  }
}
    
    res.json({
      success: true,
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        profilePicture: user.profilePicture,
        firebaseUid: user.firebaseUid,
        isOnline: user.isOnline,
        lastSeen: user.lastSeen
      },
      message: 'User synced successfully'
    });
    
  } catch (error) {
    console.error('❌ Fatal sync error:', error);
    
    res.status(500).json({
      success: false,
      message: 'Server error while syncing user',
      error: error.message
    });
  }
};

// ============================================
// SIMPLIFIED SYNC USER BY UID
// ============================================
const syncUserByUid = async (req, res) => {
  try {
    const { firebaseUid } = req.body;

    if (!firebaseUid) {
      return res.status(400).json({
        success: false,
        message: 'Firebase UID is required'
      });
    }

    console.log('\n🔄 === SYNC USER BY UID ===');
    console.log('📥 Firebase UID:', firebaseUid);

    // Try Firestore first
    const firestoreData = await fetchUserFromFirestore(firebaseUid);
    
    let name, email, profilePicture;
    
    if (firestoreData && firestoreData.name) {
      name = firestoreData.name;
      email = firestoreData.email;
      profilePicture = firestoreData.profilePicture;
    } else {
      // Fallback
      name = `User_${firebaseUid.substring(0, 6)}`;
      email = `${firebaseUid}@skybrr.com`;
      profilePicture = '';
    }

    // Create/update user
    const user = await User.findOneAndUpdate(
      { firebaseUid },
      {
        name,
        email,
        profilePicture,
        isOnline: false,
        lastSeen: new Date(),
        lastSynced: new Date()
      },
      { 
        upsert: true, 
        new: true 
      }
    );

    console.log('✅ User synced:', user.name);

    res.json({
      success: true,
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        firebaseUid: user.firebaseUid
      },
      message: 'User synced successfully'
    });

  } catch (error) {
    console.error('❌ Sync error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync user',
      error: error.message
    });
  }
};

// ============================================
// DEBUG ENDPOINT
// ============================================
const debugUser = async (req, res) => {
  try {
    const firebaseUid = req.body.firebaseUid || req.query.firebaseUid;
    
    if (!firebaseUid) {
      return res.status(400).json({
        success: false,
        message: 'Firebase UID required'
      });
    }
    
    console.log('\n🔍 === DEBUG USER ===');
    console.log('Firebase UID:', firebaseUid);
    
    // 1. Check Firebase Admin
    console.log('Firebase Admin initialized:', admin.apps.length > 0);
    
    // 2. Try Firestore
    let firestoreResult = null;
    try {
      if (admin.apps.length) {
        const firestore = admin.firestore();
        const userDoc = await firestore.collection('users').doc(firebaseUid).get();
        
        if (userDoc.exists) {
          firestoreResult = userDoc.data();
          console.log('✅ Firestore document found');
        } else {
          console.log('📭 No Firestore document');
        }
      }
    } catch (firestoreError) {
      console.log('❌ Firestore error:', firestoreError.message);
    }
    
    // 3. Check MongoDB
    let mongoUser = null;
    try {
      mongoUser = await User.findOne({ firebaseUid });
      if (mongoUser) {
        console.log('✅ MongoDB user found:', mongoUser.name);
      } else {
        console.log('📭 No MongoDB user');
      }
    } catch (mongoError) {
      console.log('❌ MongoDB error:', mongoError.message);
    }
    
    res.json({
      success: true,
      firebaseUid,
      firestoreData: firestoreResult,
      mongoUser: mongoUser,
      firebaseAdmin: admin.apps.length > 0
    });
    
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ============================================
// ROUTES
// ============================================

// Use middleware
router.use(extractUserFromToken);

// Sync endpoints
router.post('/sync', syncUserFromToken);
router.post('/sync-user', syncUserByUid);

// Debug endpoint
router.get('/debug', debugUser);
router.post('/debug', debugUser);

// Health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Auth service running',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;