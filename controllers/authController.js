const User = require('../models/User');
const { generateToken } = require('../middleware/firebaseAuth');

// @desc    Register new user with either email OR phone
// @route   POST /api/auth/register
// @access  Public
const registerUser = async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    // Validate: either email OR phone must be provided
    if (!email && !phone) {
      return res.status(400).json({
        success: false,
        message: 'Either email or phone must be provided'
      });
    }

    // Check if user exists by email OR phone
    let existingUser = null;
    if (email) {
      existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'User already exists with this email'
        });
      }
    }
    
    if (phone) {
      existingUser = await User.findOne({ phone });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'User already exists with this phone number'
        });
      }
    }

    // Create user with either email OR phone
    const user = await User.create({
      name,
      email: email || null, // Only set if provided
      phone: phone || null, // Only set if provided
      password,
      authMethod: email ? 'email' : 'phone'
    });

    if (user) {
      res.status(201).json({
        success: true,
        data: {
          _id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          profilePicture: user.profilePicture,
          status: user.status,
          authMethod: user.authMethod,
          token: generateToken(user._id),
        },
        message: `User registered successfully with ${email ? 'email' : 'phone'}`
      });
    }
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during registration',
      error: error.message
    });
  }
};

// @desc    Sync Firebase user with backend (supports both email and phone auth)
// @route   POST /api/auth/sync-user
// @access  Public (but requires Firebase token in headers)
const syncUserWithBackend = async (req, res) => {
  try {
    const { firebaseUid, email, phone, name, profilePicture, profileData } = req.body;

    console.log('🔄 Sync request:', { 
      firebaseUid, 
      email, 
      phone,
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
      // Check by email OR phone as fallback
      if (email) {
        user = await User.findOne({ email });
      } 
      if (!user && phone) {
        user = await User.findOne({ phone });
      }

      // Create new user if doesn't exist
      if (!user) {
        // Determine auth method
        const authMethod = email ? 'email' : (phone ? 'phone' : 'unknown');
        
        user = await User.create({
          firebaseUid,
          email: email || null, // DO NOT create fake email!
          phone: phone || null, // DO NOT create fake phone!
          name: name || 'New User',
          profilePicture: profilePicture || null,
          isOnline: true,
          lastSeen: new Date(),
          authMethod
        });
        console.log(`✅ Created new user from Firebase (${authMethod}):`, user._id);
      } else {
        // Update existing user with firebaseUid
        user.firebaseUid = firebaseUid;
        user.name = name || user.name;
        // Update auth method if we can determine it
        if (email && !user.email) user.email = email;
        if (phone && !user.phone) user.phone = phone;
        await user.save();
        console.log('✅ Updated existing user with Firebase UID:', user._id);
      }
    } else {
      // Update existing user with new data
      user.name = name || user.name;
      // Only update email/phone if they're not already set
      if (email && !user.email) user.email = email;
      if (phone && !user.phone) user.phone = phone;
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
        phone: user.phone,
        profilePicture: user.profilePicture,
        firebaseUid: user.firebaseUid,
        authMethod: user.authMethod,
        token: token
      },
      message: 'User synced successfully'
    });

  } catch (error) {
    console.error('❌ Sync error:', error);
    
    // Handle duplicate key errors specifically
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Duplicate email or phone. User may already exist.',
        error: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error during sync',
      error: error.message
    });
  }
};

// @desc    Authenticate user with either email OR phone
// @route   POST /api/auth/login
// @access  Public
const loginUser = async (req, res) => {
  try {
    const { email, phone, password } = req.body;

    // Validate: either email OR phone must be provided
    if (!email && !phone) {
      return res.status(400).json({
        success: false,
        message: 'Either email or phone must be provided'
      });
    }

    // Find user by email OR phone
    let user = null;
    if (email) {
      user = await User.findOne({ email }).select('+password');
    } else if (phone) {
      user = await User.findOne({ phone }).select('+password');
    }

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
          phone: user.phone,
          profilePicture: user.profilePicture,
          status: user.status,
          isOnline: user.isOnline,
          authMethod: user.authMethod,
          token: generateToken(user._id),
        },
        message: 'Login successful'
      });
    } else {
      res.status(401).json({
        success: false,
        message: 'Invalid credentials'
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

// @desc    Update user profile (with email/phone validation)
// @route   PUT /api/auth/profile
// @access  Private
const updateUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (user) {
      user.name = req.body.name || user.name;
      
      // Handle email update (check for duplicates)
      if (req.body.email && req.body.email !== user.email) {
        const existingUser = await User.findOne({ email: req.body.email });
        if (existingUser && existingUser._id.toString() !== user._id.toString()) {
          return res.status(400).json({
            success: false,
            message: 'Email already in use by another account'
          });
        }
        user.email = req.body.email;
      }
      
      // Handle phone update (check for duplicates)
      if (req.body.phone && req.body.phone !== user.phone) {
        const existingUser = await User.findOne({ phone: req.body.phone });
        if (existingUser && existingUser._id.toString() !== user._id.toString()) {
          return res.status(400).json({
            success: false,
            message: 'Phone number already in use by another account'
          });
        }
        user.phone = req.body.phone;
      }
      
      // Ensure at least one auth method is set
      if (!user.email && !user.phone) {
        return res.status(400).json({
          success: false,
          message: 'User must have either email or phone'
        });
      }
      
      user.status = req.body.status || user.status;
      user.profilePicture = req.body.profilePicture || user.profilePicture;
      
      // Update auth method
      if (user.email && !user.phone) user.authMethod = 'email';
      else if (user.phone && !user.email) user.authMethod = 'phone';
      else if (user.email && user.phone) user.authMethod = 'both';

      const updatedUser = await user.save();

      res.json({
        success: true,
        data: {
          _id: updatedUser._id,
          name: updatedUser.name,
          email: updatedUser.email,
          phone: updatedUser.phone,
          profilePicture: updatedUser.profilePicture,
          status: updatedUser.status,
          authMethod: updatedUser.authMethod,
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
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Duplicate email or phone. Another user already has this value.'
      });
    }
    
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

// @desc    Check if email/phone is available
// @route   POST /api/auth/check-availability
// @access  Public
const checkAvailability = async (req, res) => {
  try {
    const { email, phone } = req.body;

    if (!email && !phone) {
      return res.status(400).json({
        success: false,
        message: 'Either email or phone must be provided'
      });
    }

    let exists = false;
    let field = '';
    
    if (email) {
      exists = await User.exists({ email });
      field = 'email';
    } else if (phone) {
      exists = await User.exists({ phone });
      field = 'phone';
    }

    res.json({
      success: true,
      data: {
        available: !exists,
        field,
        message: exists ? 
          `${field} is already registered` : 
          `${field} is available`
      }
    });
  } catch (error) {
    console.error('Check availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error checking availability'
    });
  }
};

module.exports = {
  registerUser,
  loginUser,
  getUserProfile,
  updateUserProfile,
  logoutUser,
  syncUserWithBackend,
  checkAvailability
};