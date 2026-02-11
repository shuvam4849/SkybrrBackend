const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  // ========== AUTHENTICATION ==========
  firebaseUid: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Email authentication
  email: {
    type: String,
    unique: true,
    sparse: true,
    default: null,
    lowercase: true,
    trim: true,
    set: function(value) {
      if (typeof value === 'string') {
        value = value.trim();
      }
      return value === '' ? null : value;
    },
    match: [
      /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
      'Please add a valid email'
    ]
  },
  
  // Phone authentication
  phone: {
    type: String,
    unique: true,
    sparse: true,
    default: null,
    set: function(value) {
      if (typeof value === 'string') {
        value = value.trim();
      }
      return value === '' ? null : value;
    }
  },
  
  // Password (for email-based users)
  password: {
    type: String,
    required: false,
    select: false,
    minlength: [6, 'Password must be at least 6 characters']
  },
  
  // Track authentication method
  authMethod: {
    type: String,
    enum: ['email', 'phone', 'both', 'unknown'],
    default: 'unknown'
  },
  
  // ========== CORE PROFILE INFO ==========
  username: { 
    type: String, 
    default: '',
    trim: true,
    lowercase: true
  },
  name: {
    type: String,
    required: [true, 'Please add a name'],
    trim: true,
    maxlength: [50, 'Name cannot be more than 50 characters']
  },
  firstName: {
    type: String,
    default: '',
    trim: true
  },
  lastName: {
    type: String,
    default: '',
    trim: true
  },
  middleName: {
    type: String,
    default: '',
    trim: true
  },
  
  // ========== PROFILE DETAILS ==========
  profilePicture: {
    type: String,
    default: ''
  },
  bio: {
    type: String,
    default: '',
    maxlength: [500, 'Bio cannot be more than 500 characters']
  },
  isPrivate: {
    type: Boolean,
    default: false
  },
  website: {
    type: String,
    default: '',
    trim: true
  },
  gender: {
    type: String,
    default: '',
    enum: ['', 'male', 'female', 'other', 'prefer-not-to-say']
  },
  
  // ========== PREFERENCES ==========
  preferences: {
    emailNotifications: { type: Boolean, default: true },
    pushNotifications: { type: Boolean, default: true },
    privateAccount: { type: Boolean, default: false },
    showActivityStatus: { type: Boolean, default: true },
    allowTagging: { type: Boolean, default: true },
    allowComments: { type: Boolean, default: true },
    allowSharing: { type: Boolean, default: true },
    allowMessagesFromEveryone: { type: Boolean, default: true },
    allowStoryReplies: { type: Boolean, default: true },
    saveOriginalPhotos: { type: Boolean, default: true },
    autoPlayVideos: { type: Boolean, default: true },
    dataSaverMode: { type: Boolean, default: false },
    darkMode: { type: Boolean, default: false }
  },
  
  // ========== SYSTEM FLAGS ==========
  profileCompleted: {
    type: Boolean,
    default: false
  },
  preferencesCompleted: {
    type: Boolean,
    default: false
  },
  registrationCompleted: {
    type: Boolean,
    default: true
  },
  onboardingCompleted: {
    type: Boolean,
    default: false
  },
  firstLogin: {
    type: Boolean,
    default: true
  },
  
  // ========== STATUS & ACTIVITY ==========
  status: {
    type: String,
    default: 'Hey there! I am using WhatsApp Clone',
    maxlength: [100, 'Status cannot be more than 100 characters']
  },
  isOnline: {
    type: Boolean,
    default: false
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  lastSynced: {
    type: Date,
    default: Date.now
  },
  connectionCount: {
    type: Number,
    default: 0
  },
  
  // ========== TIMESTAMPS ==========
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  
  // ========== REFERENCE DATA ==========
  firestoreData: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  minimize: false
});

// ========== INDEXES ==========
// Sparse unique indexes for email and phone
userSchema.index({ email: 1 }, { unique: true, sparse: true });
userSchema.index({ phone: 1 }, { unique: true, sparse: true });

// Other indexes
userSchema.index({ firebaseUid: 1 });
userSchema.index({ username: 1 }, { sparse: true });
userSchema.index({ name: 1 });
userSchema.index({ isOnline: 1 });
userSchema.index({ lastSeen: -1 });
userSchema.index({ authMethod: 1 });

// ========== MIDDLEWARE ==========
// Validate that user has either email or phone
userSchema.pre('save', function(next) {
  if (!this.email && !this.phone) {
    const err = new Error('User must have either email or phone for authentication');
    return next(err);
  }
  
  // Determine auth method
  if (this.email && this.phone) {
    this.authMethod = 'both';
  } else if (this.email) {
    this.authMethod = 'email';
  } else if (this.phone) {
    this.authMethod = 'phone';
  }
  
  next();
});

// Hash password before saving (only for email users)
userSchema.pre('save', async function(next) {
  // Only hash if password is modified and user is email-based
  if (!this.isModified('password') || this.authMethod !== 'email') {
    return next();
  }
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Update authMethod when email/phone changes
userSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();
  
  if (update.email || update.phone) {
    if (!update.$set) update.$set = {};
    
    // Determine new auth method
    const email = update.email || update.$set?.email || this._conditions.email;
    const phone = update.phone || update.$set?.phone || this._conditions.phone;
    
    if (email && phone) {
      update.$set.authMethod = 'both';
    } else if (email) {
      update.$set.authMethod = 'email';
    } else if (phone) {
      update.$set.authMethod = 'phone';
    }
  }
  
  next();
});

// ========== VIRTUAL PROPERTIES ==========
// Get full name
userSchema.virtual('fullName').get(function() {
  if (this.firstName && this.lastName) {
    return `${this.firstName} ${this.lastName}`;
  }
  return this.name;
});

// Get display name
userSchema.virtual('displayName').get(function() {
  if (this.username) {
    return `@${this.username}`;
  }
  return this.fullName || this.name;
});

// Check if user has email auth
userSchema.virtual('hasEmailAuth').get(function() {
  return !!this.email;
});

// Check if user has phone auth
userSchema.virtual('hasPhoneAuth').get(function() {
  return !!this.phone;
});

// ========== STATIC METHODS ==========
// Find by Firebase UID
userSchema.statics.findByFirebaseUid = function(firebaseUid) {
  return this.findOne({ firebaseUid });
};

// Find by username
userSchema.statics.findByUsername = function(username) {
  return this.findOne({ username: username.toLowerCase() });
};

// Find by email or phone
userSchema.statics.findByEmailOrPhone = function(email, phone) {
  if (email) {
    return this.findOne({ email });
  }
  if (phone) {
    return this.findOne({ phone });
  }
  return null;
};

// Check if email exists
userSchema.statics.emailExists = async function(email) {
  const user = await this.findOne({ email });
  return !!user;
};

// Check if phone exists
userSchema.statics.phoneExists = async function(phone) {
  const user = await this.findOne({ phone });
  return !!user;
};

// Create user with proper auth method detection
userSchema.statics.createWithAuth = async function(userData) {
  const { email, phone, ...rest } = userData;
  
  if (!email && !phone) {
    throw new Error('Either email or phone must be provided');
  }
  
  // Determine auth method
  let authMethod = 'unknown';
  if (email && phone) authMethod = 'both';
  else if (email) authMethod = 'email';
  else if (phone) authMethod = 'phone';
  
  return this.create({
    email: email || null,
    phone: phone || null,
    authMethod,
    ...rest
  });
};

// Update last seen
userSchema.statics.updateLastSeen = function(firebaseUid) {
  return this.findOneAndUpdate(
    { firebaseUid },
    { 
      lastSeen: new Date(),
      isOnline: false 
    },
    { new: true }
  );
};

// Set online status
userSchema.statics.setOnline = function(firebaseUid, isOnline) {
  return this.findOneAndUpdate(
    { firebaseUid },
    { 
      isOnline,
      lastSeen: new Date() 
    },
    { new: true }
  );
};

// ========== INSTANCE METHODS ==========
// Compare password (for email auth)
userSchema.methods.matchPassword = async function(enteredPassword) {
  if (!this.password) {
    throw new Error('This user does not have password authentication');
  }
  return await bcrypt.compare(enteredPassword, this.password);
};

// Get public profile (for other users)
userSchema.methods.getPublicProfile = function() {
  return {
    _id: this._id,
    firebaseUid: this.firebaseUid,
    username: this.username,
    name: this.name,
    firstName: this.firstName,
    lastName: this.lastName,
    profilePicture: this.profilePicture,
    bio: this.bio,
    isPrivate: this.isPrivate,
    status: this.status,
    isOnline: this.isOnline,
    lastSeen: this.lastSeen,
    connectionCount: this.connectionCount
  };
};

// Get complete profile (for self)
userSchema.methods.getCompleteProfile = function() {
  return {
    _id: this._id,
    firebaseUid: this.firebaseUid,
    username: this.username,
    name: this.name,
    firstName: this.firstName,
    lastName: this.lastName,
    middleName: this.middleName,
    email: this.email,
    phone: this.phone,
    authMethod: this.authMethod,
    profilePicture: this.profilePicture,
    bio: this.bio,
    isPrivate: this.isPrivate,
    website: this.website,
    gender: this.gender,
    preferences: this.preferences,
    profileCompleted: this.profileCompleted,
    preferencesCompleted: this.preferencesCompleted,
    registrationCompleted: this.registrationCompleted,
    onboardingCompleted: this.onboardingCompleted,
    status: this.status,
    isOnline: this.isOnline,
    lastSeen: this.lastSeen,
    lastSynced: this.lastSynced,
    connectionCount: this.connectionCount,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

// Check if profile is complete
userSchema.methods.isProfileComplete = function() {
  return this.profileCompleted && 
         this.preferencesCompleted && 
         this.registrationCompleted &&
         !!this.name &&
         (!!this.email || !!this.phone); // At least one auth method
};

// Update authentication method
userSchema.methods.updateAuthMethod = function() {
  if (this.email && this.phone) {
    this.authMethod = 'both';
  } else if (this.email) {
    this.authMethod = 'email';
  } else if (this.phone) {
    this.authMethod = 'phone';
  } else {
    this.authMethod = 'unknown';
  }
  return this.save();
};

// Add email authentication
userSchema.methods.addEmailAuth = async function(email, password) {
  if (this.email) {
    throw new Error('User already has email authentication');
  }
  
  // Check if email is already taken
  const existingUser = await this.constructor.findOne({ email });
  if (existingUser) {
    throw new Error('Email already registered to another user');
  }
  
  this.email = email;
  this.password = password;
  
  if (this.phone) {
    this.authMethod = 'both';
  } else {
    this.authMethod = 'email';
  }
  
  return this.save();
};

// Add phone authentication
userSchema.methods.addPhoneAuth = async function(phone) {
  if (this.phone) {
    throw new Error('User already has phone authentication');
  }
  
  // Check if phone is already taken
  const existingUser = await this.constructor.findOne({ phone });
  if (existingUser) {
    throw new Error('Phone number already registered to another user');
  }
  
  this.phone = phone;
  
  if (this.email) {
    this.authMethod = 'both';
  } else {
    this.authMethod = 'phone';
  }
  
  return this.save();
};

module.exports = mongoose.model('User', userSchema);