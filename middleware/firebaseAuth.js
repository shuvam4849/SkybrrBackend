const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// Initialize Firebase Admin using Service Account JSON file
const initializeFirebaseAdmin = () => {
  if (!admin.apps.length) {
    try {
      // Load the service account key from JSON file
      const serviceAccountPath = path.join(__dirname, '../serviceAccountKey.json');
      
      // Check if file exists
      if (!fs.existsSync(serviceAccountPath)) {
        console.log('⚠️  serviceAccountKey.json not found - Firebase Admin disabled');
        return null;
      }
      
      // Read and parse the service account file
      const serviceAccountData = fs.readFileSync(serviceAccountPath, 'utf8');
      const serviceAccount = JSON.parse(serviceAccountData);
      
      // Ensure private key has proper newlines
      if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }
      
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
      });
      
      console.log('✅ Firebase Admin initialized for project:', serviceAccount.project_id);
      return admin;
    } catch (error) {
      console.error('❌ Failed to initialize Firebase Admin:', error.message);
      console.error('Error details:', error);
      return null;
    }
  }
  return admin;
};

const adminInstance = initializeFirebaseAdmin();

const firebaseProtect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    try {
      if (!adminInstance) {
        console.log('❌ Firebase Admin not initialized');
        return res.status(401).json({
          success: false,
          message: 'Firebase Admin not configured'
        });
      }

      // Get token from header
      token = req.headers.authorization.split(' ')[1];

      // Verify token with Firebase Admin
      const decodedToken = await adminInstance.auth().verifyIdToken(token);
      
      console.log('✅ Firebase token verified for user:', decodedToken.uid);
      
      // Get user from our database
      const User = require('../models/User');
      let user = await User.findOne({ firebaseUid: decodedToken.uid });
      
      if (!user) {
        console.log('👤 Creating new user in backend database');
        try {
          // Create user in our database
          user = await User.create({
            firebaseUid: decodedToken.uid,
            name: decodedToken.name || decodedToken.email.split('@')[0],
            email: decodedToken.email,
            profilePicture: decodedToken.picture || '',
            phone: decodedToken.phone_number || '',
          });
          
          console.log('✅ New user created in backend database:', user._id);
        } catch (createError) {
          // Handle duplicate key error
          if (createError.code === 11000) {
            console.log('⚠️  User already exists, fetching existing user');
            
            // Try multiple ways to find the user
            user = await User.findOne({ firebaseUid: decodedToken.uid });
            
            if (!user) {
              // Try finding by email as fallback
              user = await User.findOne({ email: decodedToken.email });
            }
            
            if (!user) {
              console.error('❌ User not found after duplicate error, creating minimal user');
              // Create a minimal user as last resort
              user = await User.create({
                firebaseUid: decodedToken.uid,
                name: decodedToken.name || decodedToken.email.split('@')[0],
                email: decodedToken.email,
                profilePicture: decodedToken.picture || '',
              });
              console.log('✅ Minimal user created as fallback:', user._id);
            } else {
              console.log('✅ Retrieved existing user:', user._id);
            }
          } else {
            console.error('❌ User creation error:', createError);
            throw createError;
          }
        }
      } else {
        console.log('✅ Existing user found:', user._id);
      }

      // CRITICAL: Make sure user is set
      if (!user) {
        console.error('❌ User is null after authentication');
        return res.status(500).json({
          success: false,
          message: 'User authentication failed'
        });
      }

      req.user = user;
      console.log('🔐 User set in request:', req.user._id);
      next();
    } catch (error) {
      console.error('❌ Firebase token verification error:', error.message);
      
      if (error.code === 'auth/id-token-expired') {
        return res.status(401).json({
          success: false,
          message: 'Token expired, please login again'
        });
      } else if (error.code === 'auth/id-token-revoked') {
        return res.status(401).json({
          success: false,
          message: 'Token revoked, please login again'
        });
      } else {
        return res.status(401).json({
          success: false,
          message: 'Not authorized, token verification failed'
        });
      }
    }
  } else {
    return res.status(401).json({
      success: false,
      message: 'Not authorized, no token provided'
    });
  }
};

module.exports = { firebaseProtect };