// Add to your server.js or create a new file firebase-sync.js

const admin = require('firebase-admin');

// Listen for user deletion from Firebase Auth
function setupUserDeletionListener() {
  console.log('👂 Setting up Firebase user deletion listener...');
  
  // Listen for user deletion
  admin.auth().onUserDeleted(async (user) => {
    try {
      console.log(`🗑️ Firebase user deleted: ${user.uid}`);
      
      // 1. Delete from Firestore users collection
      const firestore = admin.firestore();
      await firestore.collection('users').doc(user.uid).delete();
      console.log(`✅ Deleted from Firestore: ${user.uid}`);
      
      // 2. Delete from MongoDB
      const deleted = await User.findOneAndDelete({ firebaseUid: user.uid });
      if (deleted) {
        console.log(`✅ Deleted from MongoDB: ${user.uid} (${deleted.email})`);
      } else {
        console.log(`⚠️ User not found in MongoDB: ${user.uid}`);
      }
      
      // 3. Clean up related data (chats, messages, etc.)
      await cleanupUserData(user.uid);
      
    } catch (error) {
      console.error(`❌ Error deleting user ${user.uid}:`, error);
    }
  });
  
  // Listen for user creation to auto-sync
  admin.auth().onUserCreated(async (user) => {
    try {
      console.log(`👤 New Firebase user created: ${user.uid}`);
      
      // Auto-sync new user to MongoDB
      setTimeout(() => {
        syncNewUserToBackend(user.uid);
      }, 5000); // Wait 5 seconds for Firestore to create document
      
    } catch (error) {
      console.error(`❌ Error handling new user ${user.uid}:`, error);
    }
  });
}

// Clean up user-related data
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
      
      // Sync to MongoDB
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

module.exports = { setupUserDeletionListener };