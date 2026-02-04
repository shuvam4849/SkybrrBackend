// firestore-users-cleanup.js
const admin = require('firebase-admin');
const dotenv = require('dotenv');

dotenv.config();

// Initialize Firebase Admin SDK
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const auth = admin.auth();

const BATCH_SIZE = 500;

async function deleteAllUsersAndData() {
  console.log('🚀 Starting user data cleanup...');
  console.log('='.repeat(50));
  
  try {
    // Step 1: Get all users
    let listUsersResult;
    let allUserIds = [];
    
    do {
      listUsersResult = listUsersResult 
        ? await auth.listUsers(1000, listUsersResult.pageToken)
        : await auth.listUsers(1000);
      
      const userIds = listUsersResult.users.map(user => user.uid);
      allUserIds = [...allUserIds, ...userIds];
      
      console.log(`📋 Collected ${userIds.length} users (Total: ${allUserIds.length})`);
      
    } while (listUsersResult.pageToken);
    
    console.log(`👥 Total users found: ${allUserIds.length}`);
    
    if (allUserIds.length === 0) {
      console.log('ℹ️  No users found to delete');
      process.exit(0);
    }
    
    // Step 2: Delete user-related data from Firestore
    console.log('🗑️  Deleting user data from Firestore...');
    
    // Collections that contain user data
    const userCollections = ['users', 'posts', 'comments', 'likes', 'followers', 'following', 'notifications', 'chats', 'messages'];
    
    for (const collectionName of userCollections) {
      await deleteDocumentsByUserIds(collectionName, allUserIds);
    }
    
    console.log('='.repeat(50));
    
    // Step 3: Delete users from Authentication
    console.log('🚫 Deleting users from Authentication...');
    
    // Delete users in batches of 1000 (Firebase Auth limit)
    for (let i = 0; i < allUserIds.length; i += 1000) {
      const batch = allUserIds.slice(i, i + 1000);
      await auth.deleteUsers(batch);
      console.log(`✅ Deleted batch ${Math.floor(i/1000) + 1}: ${batch.length} users`);
    }
    
    console.log('='.repeat(50));
    console.log('✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨');
    console.log(`✨ Successfully deleted ${allUserIds.length} users and their data! ✨`);
    console.log('✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨');
    
  } catch (error) {
    console.error('💥 Cleanup failed:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

async function deleteDocumentsByUserIds(collectionName, userIds) {
  console.log(`🗑️  Deleting ${collectionName} for ${userIds.length} users...`);
  
  try {
    const collectionRef = db.collection(collectionName);
    let deletedCount = 0;
    
    // Process in smaller batches
    for (let i = 0; i < userIds.length; i += 100) {
      const batchUserIds = userIds.slice(i, i + 100);
      
      // For each user ID in the batch, delete documents where they're the author/owner
      for (const userId of batchUserIds) {
        // Try different field names where user ID might be stored
        const queries = [
          collectionRef.where('uid', '==', userId),
          collectionRef.where('userId', '==', userId),
          collectionRef.where('authorId', '==', userId),
          collectionRef.where('ownerId', '==', userId),
          collectionRef.where('from', '==', userId),
          collectionRef.where('to', '==', userId),
        ];
        
        for (const query of queries) {
          try {
            const snapshot = await query.get();
            if (!snapshot.empty) {
              const batch = db.batch();
              snapshot.docs.forEach(doc => {
                batch.delete(doc.ref);
              });
              await batch.commit();
              deletedCount += snapshot.size;
              console.log(`   Deleted ${snapshot.size} documents from ${collectionName} for user ${userId}`);
            }
          } catch (queryError) {
            // Some queries might fail if the field doesn't exist in the collection
            continue;
          }
        }
      }
    }
    
    console.log(`✅ Deleted ${deletedCount} documents from ${collectionName}`);
    
  } catch (error) {
    console.error(`❌ Error deleting ${collectionName}:`, error.message);
  }
}

// Run the cleanup
deleteAllUsersAndData();