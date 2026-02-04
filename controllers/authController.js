const User = require('../models/User');
const { generateToken } = require('../middleware/firebaseAuth');

// @desc    Register new user
// @route   POST /api/auth/register
// @access  Public
const registerUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Check if user exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email'
      });
    }

    // Create user
    const user = await User.create({
      name,
      email,
      password,
    });

    if (user) {
      res.status(201).json({
        success: true,
        data: {
          _id: user._id,
          name: user.name,
          email: user.email,
          profilePicture: user.profilePicture,
          status: user.status,
          token: generateToken(user._id),
        },
        message: 'User registered successfully'
      });
    }
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
};

// @desc    Sync Firebase user with backend
// @route   POST /api/auth/sync-user
// @access  Public (but requires Firebase token in headers)
const syncUserWithBackend = async (req, res) => {
  try {
    const { firebaseUid, email, name, profilePicture, profileData } = req.body;

    console.log('🔄 Sync request:', { 
      firebaseUid, 
      email, 
      name, 
      hasProfileData: !!profileData 
    });

    if (!firebaseUid) {
      return res.status(400).json({
        success: false,
        message: 'Firebase UID is required'
      });
    }

    // Check if user exists by firebaseUid
    let user = await User.findOne({ firebaseUid });

    if (!user) {
      // Check by email as fallback
      if (email) {
        user = await User.findOne({ email });
      }

      // Create new user if doesn't exist
      if (!user) {
        user = await User.create({
          firebaseUid,
          email: email || `${firebaseUid}@skybrr.com`,
          name: name || 'New User',
          profilePicture: profilePicture || null,
          isOnline: true,
          lastSeen: new Date()
        });
        console.log('✅ Created new user from Firebase:', user._id);
      } else {
        // Update existing user with firebaseUid
        user.firebaseUid = firebaseUid;
        user.name = name || user.name; // Update name if provided
        await user.save();
        console.log('✅ Updated existing user with Firebase UID:', user._id);
      }
    } else {
      // Update existing user with new data
      user.name = name || user.name;
      user.email = email || user.email;
      user.profilePicture = profilePicture || user.profilePicture;
      await user.save();
      console.log('✅ Updated existing user:', user._id);
    }

    // Generate token
    const token = generateToken(user._id);

    res.json({
      success: true,
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        profilePicture: user.profilePicture,
        firebaseUid: user.firebaseUid,
        token: token
      },
      message: 'User synced successfully'
    });

  } catch (error) {
    console.error('❌ Sync error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during sync',
      error: error.message
    });
  }
};

// @desc    Authenticate user & get token
// @route   POST /api/auth/login
// @access  Public
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check for user email and include password for verification
    const user = await User.findOne({ email }).select('+password');

    if (user && (await user.matchPassword(password))) {
      // Update user as online
      user.isOnline = true;
      user.lastSeen = new Date();
      await user.save();

      res.json({
        success: true,
        data: {
          _id: user._id,
          name: user.name,
          email: user.email,
          profilePicture: user.profilePicture,
          status: user.status,
          isOnline: user.isOnline,
          token: generateToken(user._id),
        },
        message: 'Login successful'
      });
    } else {
      res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
};

// @desc    Get user profile
// @route   GET /api/auth/profile
// @access  Private
const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching profile'
    });
  }
};

// @desc    Update user profile
// @route   PUT /api/auth/profile
// @access  Private
const updateUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (user) {
      user.name = req.body.name || user.name;
      user.email = req.body.email || user.email;
      user.status = req.body.status || user.status;
      user.profilePicture = req.body.profilePicture || user.profilePicture;

      const updatedUser = await user.save();

      res.json({
        success: true,
        data: {
          _id: updatedUser._id,
          name: updatedUser.name,
          email: updatedUser.email,
          profilePicture: updatedUser.profilePicture,
          status: updatedUser.status,
          token: generateToken(updatedUser._id),
        },
        message: 'Profile updated successfully'
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating profile'
    });
  }
};

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
const logoutUser = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    if (user) {
      user.isOnline = false;
      user.lastSeen = new Date();
      await user.save();
    }

    res.json({
      success: true,
      message: 'Logout successful'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during logout'
    });
  }
};

module.exports = {
  registerUser,
  loginUser,
  getUserProfile,
  updateUserProfile,
  logoutUser,
  syncUserWithBackend
};