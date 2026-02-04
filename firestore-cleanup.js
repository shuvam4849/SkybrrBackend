// firestore-cleanup.js
const admin = require('firebase-admin');
const dotenv = require('dotenv');

dotenv.config();

// Initialize Firebase Admin SDK
const serviceAccount = require('./serviceAccountKey.json'); // Path to your service account key

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const auth = admin.auth();

const BATCH_SIZE = 500; // Firestore batch limit

async function deleteAllUsers() {
  try {
    console.log('🚫 Starting to delete all users...');
    
    let listUsersResult;
    let deletedCount = 0;
    
    // List all users in batches
    do {
      listUsersResult = listUsersResult 
        ? await auth.listUsers(1000, listUsersResult.pageToken)
        : await auth.listUsers(1000);
      
      const users = listUsersResult.users;
      console.log(`📋 Found ${users.length} users to delete...`);
      
      // Delete users from Authentication
      await auth.deleteUsers(users.map(user => user.uid));
      
      deletedCount += users.length;
      console.log(`✅ Deleted ${users.length} users from Authentication (Total: ${deletedCount})`);
      
    } while (listUsersResult.pageToken);
    
    console.log(`🎉 Successfully deleted ${deletedCount} users from Authentication`);
    
  } catch (error) {
    console.error('❌ Error deleting users:', error);
    throw error;
  }
}

async function deleteAllFirestoreData() {
  try {
    console.log('🗑️  Starting to delete all Firestore data...');
    
    // Get all collections
    const collections = await db.listCollections();
    console.log(`📚 Found ${collections.length} collections`);
    
    for (const collectionRef of collections) {
      await deleteCollection(collectionRef.id);
    }
    
    console.log('🎉 Successfully deleted all Firestore data');
    
  } catch (error) {
    console.error('❌ Error deleting Firestore data:', error);
    throw error;
  }
}

async function deleteCollection(collectionName) {
  console.log(`🗑️  Deleting collection: ${collectionName}`);
  
  const collectionRef = db.collection(collectionName);
  const query = collectionRef.orderBy('__name__').limit(BATCH_SIZE);
  
  return new Promise((resolve, reject) => {
    deleteQueryBatch(query, resolve, reject, collectionName);
  });
}

function deleteQueryBatch(query, resolve, reject, collectionName) {
  query.get()
    .then((snapshot) => {
      // If there are no documents left, we are done
      if (snapshot.size === 0) {
        console.log(`✅ Collection ${collectionName} deleted`);
        return resolve();
      }

      // Delete documents in a batch
      const batch = db.batch();
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });

      return batch.commit().then(() => {
        console.log(`📄 Deleted ${snapshot.size} documents from ${collectionName}`);
        // Recurse on the next process tick, to avoid
        // exploding the stack.
        process.nextTick(() => {
          deleteQueryBatch(query, resolve, reject, collectionName);
        });
      });
    })
    .catch(reject);
}

async function deleteStorageData() {
  try {
    console.log('🗄️  Starting to delete all Storage data...');
    
    const bucket = admin.storage().bucket();
    
    // List all files in the bucket
    const [files] = await bucket.getFiles();
    
    console.log(`📁 Found ${files.length} files in Storage`);
    
    // Delete files in batches
    for (let i = 0; i < files.length; i += 100) {
      const batch = files.slice(i, i + 100);
      await Promise.all(batch.map(file => file.delete()));
      console.log(`🗑️  Deleted ${Math.min(i + 100, files.length)}/${files.length} files`);
    }
    
    console.log('🎉 Successfully deleted all Storage data');
    
  } catch (error) {
    console.error('❌ Error deleting Storage data:', error);
    // Continue even if storage fails
  }
}

async function cleanupDatabase() {
  console.log('🚀 Starting database cleanup...');
  console.log('='.repeat(50));
  
  try {
    // Delete Firestore data first (so we don't have dangling references)
    await deleteAllFirestoreData();
    console.log('='.repeat(50));
    
    // Delete Storage data (user uploads, avatars, etc.)
    await deleteStorageData();
    console.log('='.repeat(50));
    
    // Delete Authentication users last
    await deleteAllUsers();
    console.log('='.repeat(50));
    
    console.log('✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨');
    console.log('✨ Database cleanup completed! ✨');
    console.log('✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨');
    
  } catch (error) {
    console.error('💥 Cleanup failed:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

// Run the cleanup
cleanupDatabase();