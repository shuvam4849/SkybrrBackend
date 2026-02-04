// cleanup-database.js
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const connectDB = require('./config/database');

const cleanupDatabase = async () => {
  try {
    await connectDB();
    
    const User = require('./models/User');
    const Chat = require('./models/Chat');
    const Message = require('./models/Message');
    
    console.log('🧹 Cleaning up database...');
    
    // Delete all data
    await User.deleteMany({});
    await Chat.deleteMany({});
    await Message.deleteMany({});
    
    console.log('✅ Database cleaned up successfully');
    
    // Recreate indexes
    await User.syncIndexes();
    await Chat.syncIndexes();
    await Message.syncIndexes();
    
    console.log('✅ Indexes recreated');
    
    process.exit(0);
  } catch (error) {
    console.error('Cleanup error:', error);
    process.exit(1);
  }
};

cleanupDatabase();