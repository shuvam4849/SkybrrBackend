// create-target-user.js
const mongoose = require('mongoose');
require('dotenv').config();

async function createTargetUser() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB Connected');
    
    const User = require('./models/User');
    
    // Target user's Firebase UID
    const firebaseUid = 'xmmlKwXv6fMEOgSoa3s8dhDcXq92';
    
    // Check if user already exists
    let targetUser = await User.findOne({ firebaseUid });
    
    if (targetUser) {
      console.log('✅ User already exists:', {
        id: targetUser._id,
        name: targetUser.name,
        email: targetUser.email,
        firebaseUid: targetUser.firebaseUid
      });
    } else {
      // Create the target user
      targetUser = await User.create({
        firebaseUid: firebaseUid,
        name: 'Test User',
        email: 'test@example.com',
        username: 'testuser',
        profilePicture: 'https://api.dicebear.com/7.x/avataaars/svg?seed=testuser',
        status: 'Hello! I\'m a test user',
        isOnline: false,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      console.log('✅ Created target user:', {
        id: targetUser._id,
        name: targetUser.name,
        email: targetUser.email,
        firebaseUid: targetUser.firebaseUid
      });
    }
    
    // Verify both users exist
    const allUsers = await User.find({});
    console.log('\n📊 All users in database:');
    allUsers.forEach(user => {
      console.log(`   👤 ${user.name} (${user.email}) - Firebase: ${user.firebaseUid}`);
    });
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

createTargetUser();