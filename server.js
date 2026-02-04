const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');
const admin = require('firebase-admin');
const mongoose = require('mongoose');
const { CronJob } = require('cron');
const userRoutes = require('./routes/userRoutes');
const messageRequestRoutes = require('./routes/messageRequestRoutes');

// Load env vars
dotenv.config();

// Import database connection
const connectDB = require('./config/database');

// Initialize Firebase Admin
try {
  if (process.env.FIREBASE_PRIVATE_KEY) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      })
    });
    console.log('✅ Firebase Admin initialized with env variables');
  } else {
    console.log('⚠️ Firebase Admin not initialized - missing env variables');
  }
} catch (error) {
  console.log('ℹ️ Firebase Admin init skipped:', error.message);
}

// Initialize express app
const app = express();
const server = http.createServer(app);

// ✅ Create Socket.io instance
const io = socketIo(server, {
  cors: {
    origin: [
      "http://localhost:8081",
      "http://192.168.1.5:8081",
      "http://192.168.1.7:8081",
      "exp://192.168.1.5:8081",
      "http://10.0.2.2:8081",
      "http://localhost:19006",
      "*"
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Store io instance in app
app.set('io', io);

// Connect to database
connectDB();

// ============================================
// USER DELETION & SYNC LISTENERS
// ============================================

app.delete('/api/user/:firebaseUid', async (req, res) => {
  const { firebaseUid } = req.params;

  await admin.auth().deleteUser(firebaseUid);
  await admin.firestore().collection('users').doc(firebaseUid).delete();
  await User.findOneAndDelete({ firebaseUid });
  await cleanupUserData(firebaseUid);

  res.json({ success: true });
});

// Helper function to clean up user-related data
async function cleanupUserData(firebaseUid) {
  try {
    const firestore = admin.firestore();
    
    // Delete user's chats
    const chatsQuery = firestore.collection('chats')
      .where('participants', 'array-contains', firebaseUid);
    
    const chatsSnapshot = await chatsQuery.get();
    const batch = firestore.batch();
    
    chatsSnapshot.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    await batch.commit();
    console.log(`🗑️ Deleted ${chatsSnapshot.size} chats for user ${firebaseUid}`);
    
    // Delete user's messages
    const messagesQuery = firestore.collection('messages')
      .where('senderId', '==', firebaseUid);
    
    const messagesSnapshot = await messagesQuery.get();
    const messagesBatch = firestore.batch();
    
    messagesSnapshot.forEach(doc => {
      messagesBatch.delete(doc.ref);
    });
    
    await messagesBatch.commit();
    console.log(`🗑️ Deleted ${messagesSnapshot.size} messages for user ${firebaseUid}`);
    
  } catch (error) {
    console.error(`❌ Error cleaning up data for ${firebaseUid}:`, error);
  }
}

// Sync new user to backend
async function syncNewUserToBackend(firebaseUid) {
  try {
    console.log(`🔄 Auto-syncing new user: ${firebaseUid}`);
    
    // Wait for Firestore document to be created
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Get user data from Firestore
    const firestore = admin.firestore();
    const userDoc = await firestore.collection('users').doc(firebaseUid).get();
    
    if (userDoc.exists) {
      const userData = userDoc.data();
      const User = require('./models/User');
      
      // Check if already exists in MongoDB
      const existingUser = await User.findOne({ firebaseUid });
      
      if (!existingUser) {
        const newUser = new User({
          firebaseUid,
          username: userData.username || '',
          name: userData.firstName && userData.lastName 
            ? `${userData.firstName} ${userData.lastName}` 
            : userData.username || `User_${firebaseUid.substring(0, 6)}`,
          email: userData.email || `${firebaseUid}@skybrr.com`,
          profilePicture: userData.avatar || '',
          bio: userData.bio || '',
          isPrivate: userData.isPrivate || false,
          registrationCompleted: userData.registrationCompleted || true,
          preferencesCompleted: userData.preferencesCompleted || true,
          onboardingCompleted: userData.onboardingCompleted || true,
          preferences: userData.preferences || {},
          lastSynced: new Date()
        });
        
        await newUser.save();
        console.log(`✅ Auto-synced new user to MongoDB: ${firebaseUid}`);
      }
    }
    
  } catch (error) {
    console.error(`❌ Error auto-syncing user ${firebaseUid}:`, error);
  }
}

// Periodic sync check
async function periodicSyncCheck() {
  try {
    const User = require('./models/User');
    
    // Get all Firebase users
    const firebaseUsers = await admin.auth().listUsers();
    const firebaseUids = firebaseUsers.users.map(u => u.uid);
    
    // Get all MongoDB users
    const mongoUsers = await User.find({}, 'firebaseUid');
    const mongoUids = mongoUsers.map(u => u.firebaseUid);
    
    // Find users in MongoDB but not in Firebase (orphaned)
    const orphanedUids = mongoUids.filter(uid => !firebaseUids.includes(uid));
    
    if (orphanedUids.length > 0) {
      console.log(`🗑️ Found ${orphanedUids.length} orphaned users, deleting...`);
      await User.deleteMany({ firebaseUid: { $in: orphanedUids } });
      console.log(`✅ Deleted ${orphanedUids.length} orphaned users`);
    }
    
    // Find users in Firebase but not in MongoDB (missing)
    const missingUids = firebaseUids.filter(uid => !mongoUids.includes(uid));
    
    if (missingUids.length > 0) {
      console.log(`🔄 Found ${missingUids.length} missing users, syncing...`);
      
      for (const uid of missingUids) {
        await syncNewUserToBackend(uid);
      }
    }
    
    console.log('✅ Periodic sync check completed');
    
  } catch (error) {
    console.error('❌ Periodic sync error:', error);
  }
}

// ============================================
// MIDDLEWARE & ROUTES
// ============================================

// ✅ CORS Middleware
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      "http://localhost:8081",
      "http://192.168.1.5:8081",
      "http://192.168.1.7:8081",
      "exp://192.168.1.5:8081",
      "http://10.0.2.2:8081",
      "http://localhost:19006"
    ];
    
    if (allowedOrigins.indexOf(origin) !== -1 || origin.includes('localhost') || origin.includes('192.168')) {
      callback(null, true);
    } else {
      console.log('⚠️ CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// ✅ Handle preflight requests
app.options('*', cors());

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`\n${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
  next();
});

// ✅ Add middleware to pass io to ALL requests
app.use((req, res, next) => {
  req.io = io;
  req.firebaseAdmin = admin;
  next();
});

// Serve static files
app.use('/uploads', express.static('uploads'));

// ✅ SIMPLE TEST ROUTE
app.post('/api/test-sync', (req, res) => {
  console.log('✅ Test sync endpoint hit!');
  res.json({
    success: true,
    message: 'Test sync endpoint working!',
    receivedData: req.body,
    timestamp: new Date().toISOString()
  });
});

// Import routes
const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const messageRoutes = require('./routes/messageRoutes');
const uploadRoutes = require('./routes/upload');

// Use routes
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/chat', messageRequestRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/user', userRoutes);

// Add manual user deletion endpoint
app.delete('/api/user/:firebaseUid', async (req, res) => {
  try {
    const { firebaseUid } = req.params;
    const User = require('./models/User');
    
    console.log(`🗑️ Manual user deletion request for: ${firebaseUid}`);
    
    // 1. Delete from Firebase Auth
    await admin.auth().deleteUser(firebaseUid);
    
    // 2. Delete from Firestore
    const firestore = admin.firestore();
    await firestore.collection('users').doc(firebaseUid).delete();
    
    // 3. Delete from MongoDB
    const deleted = await User.findOneAndDelete({ firebaseUid });
    
    // 4. Clean up related data
    await cleanupUserData(firebaseUid);
    
    res.json({
      success: true,
      message: `User ${firebaseUid} deleted from all systems`,
      deletedFrom: {
        firebaseAuth: true,
        firestore: true,
        mongodb: !!deleted
      }
    });
    
  } catch (error) {
    console.error('❌ Manual deletion error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Enhanced health check route
app.get('/api/health', async (req, res) => {
  try {
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    
    res.json({
      success: true,
      message: 'WhatsApp Clone Backend is running!',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      database: dbStatus,
      firebase: !!admin.apps.length,
      socketClients: io.engine.clientsCount,
      userSync: admin.apps.length > 0 ? 'active' : 'inactive',
      memory: process.memoryUsage(),
      uptime: process.uptime()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Health check failed',
      error: error.message
    });
  }
});

// Root route
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'WhatsApp Clone Backend API',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      testSync: '/api/test-sync',
      auth: '/api/auth',
      chat: '/api/chat',
      messages: '/api/messages',
      upload: '/api/upload',
      messageRequests: '/api/chat/requests',
      user: '/api/user',
      deleteUser: '/api/user/:firebaseUid (DELETE)'
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
    availableEndpoints: [
      '/api/health',
      '/api/test-sync',
      '/api/auth',
      '/api/chat',
      '/api/messages',
      '/api/upload',
      '/api/user',
      '/api/chat/requests',
      '/api/chat/request',
      '/api/user/:firebaseUid (DELETE)'
    ]
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('❌ Global error handler:', error);
  
  console.error('Error details:', {
    name: error.name,
    message: error.message,
    stack: error.stack,
    code: error.code,
    keyValue: error.keyValue
  });
  
  if (error.name === 'ValidationError') {
    const messages = Object.values(error.errors).map(val => val.message);
    return res.status(400).json({
      success: false,
      message: 'Validation Error',
      errors: messages
    });
  }
  
  if (error.code === 11000) {
    const field = Object.keys(error.keyValue)[0];
    const value = error.keyValue[field];
    return res.status(400).json({
      success: false,
      message: `Duplicate value: ${field} "${value}" already exists`,
      field: field
    });
  }
  
  if (error.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: `Invalid ID format: ${error.value}`
    });
  }
  
  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || 'Internal Server Error',
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
  });
});

// Configure socket
const configureSocket = require('./socket/socketHandler');
configureSocket(io);

// Start server
const PORT = process.env.PORT || 5000;
const os = require('os');

function getNetworkIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const interface of interfaces[name]) {
      if (interface.family === 'IPv4' && !interface.internal) {
        return interface.address;
      }
    }
  }
  return 'localhost';
}

const networkIP = getNetworkIP();

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '='.repeat(50));
  console.log('🚀 WhatsApp Clone Backend');
  console.log('='.repeat(50));
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`📍 Network: http://${networkIP}:${PORT}`);
  console.log(`✅ Health check: http://localhost:${PORT}/api/health`);
  console.log(`✅ Test sync: POST http://localhost:${PORT}/api/test-sync`);
  console.log(`🔥 Socket.io: ws://localhost:${PORT}`);
  console.log(`📱 Firebase Admin: ${admin.apps.length > 0 ? '✅ Initialized' : '⚠️ Not initialized'}`);
  console.log(`🗑️  User Deletion Sync: ${admin.apps.length > 0 ? '✅ Active' : '⚠️ Inactive'}`);
  console.log('📨 Message Requests API Available at:');
  console.log(`   POST   /api/chat/request`);
  console.log(`   GET    /api/chat/requests`);
  console.log(`   POST   /api/chat/requests/:id/accept`);
  console.log(`   POST   /api/chat/requests/:id/reject`);
  console.log('='.repeat(50) + '\n');
});

module.exports = app;