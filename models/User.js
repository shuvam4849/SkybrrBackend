const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  // Firebase ID (unique identifier)
  firebaseUid: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // ========== CORE PROFILE INFO (ROOT LEVEL) ==========
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
  email: {
    type: String,
    required: false,
    unique: true, // Keep this for email uniqueness
    sparse: true, // Already have this
  lowercase: true,
  trim: true,
  default: null, // CHANGE FROM NO DEFAULT TO null
  set: function(value) {
    // Convert empty string to null
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
 phone: {
  type: String,
  default: null, // CHANGE FROM '' TO null
  sparse: true,
  set: function(value) {
    // Convert empty string to null
    if (typeof value === 'string') {
      value = value.trim();
    }
    return value === '' ? null : value;
  }
},
  
  // ========== PREFERENCES (NESTED OBJECT) ==========
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
    default: true // ✅ Default to true
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
  // Store full firestore data for debugging/reference
  firestoreData: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true, // Auto manages createdAt and updatedAt
  minimize: false // Ensures empty objects are saved
});

// ========== INDEXES ==========
userSchema.index({ firebaseUid: 1 });
userSchema.index({ email: 1 });
userSchema.index({ username: 1 }, { sparse: true });
userSchema.index({ name: 1 });
userSchema.index({ isOnline: 1 });
userSchema.index({ lastSeen: -1 });

// ========== MIDDLEWARE ==========
// Add this to your User model schema:
userSchema.pre('validate', function(next) {
  // Ensure at least email OR phone is provided
  const hasEmail = this.email && this.email.trim() !== '';
  const hasPhone = this.phone && this.phone.trim() !== '';
  
  if (!hasEmail && !hasPhone) {
    const err = new Error('At least email or phone must be provided');
    return next(err);
  }
  
  next();
});
// ========== VIRTUAL PROPERTIES ==========
// Get full name (firstName + lastName)
userSchema.virtual('fullName').get(function() {
  if (this.firstName && this.lastName) {
    return `${this.firstName} ${this.lastName}`;
  }
  return this.name;
});

// Get display name (prioritizes username)
userSchema.virtual('displayName').get(function() {
  if (this.username) {
    return `@${this.username}`;
  }
  return this.fullName || this.name;
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
         !!this.username &&
         !!this.name;
};

module.exports = mongoose.model('User', userSchema);