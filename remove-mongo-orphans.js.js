// Cleanup script: remove-mongo-orphans.js
const mongoose = require('mongoose');
const User = require('./models/User');
const admin = require('firebase-admin');

require('dotenv').config();

async function cleanupOrphanedUsers() {
  try {
    // 1. Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // 2. Initialize Firebase Admin
    const serviceAccount = require('./serviceAccountKey.json');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    
    const firestore = admin.firestore();
    
    // 3. Get all Firebase users
    const firebaseUsers = await admin.auth().listUsers();
    const firebaseUids = firebaseUsers.users.map(u => u.uid);
    console.log(`📊 Firebase has ${firebaseUids.length} users`);
    
    // 4. Get all Firestore users
    const firestoreSnapshot = await firestore.collection('users').get();
    const firestoreUids = firestoreSnapshot.docs.map(doc => doc.id);
    console.log(`📊 Firestore has ${firestoreUids.length} users`);
    
    // 5. Get all MongoDB users
    const mongoUsers = await User.find({}, 'firebaseUid');
    console.log(`📊 MongoDB has ${mongoUsers.length} users`);
    
    // 6. Find orphaned users in MongoDB (not in Firebase OR Firestore)
    const activeUids = [...new Set([...firebaseUids, ...firestoreUids])];
    
    const orphanedUsers = mongoUsers.filter(user => 
      !activeUids.includes(user.firebaseUid)
    );
    
    console.log(`🔍 Found ${orphanedUsers.length} orphaned users in MongoDB`);
    
    // 7. Delete orphaned users
    if (orphanedUsers.length > 0) {
      const orphanedUids = orphanedUsers.map(u => u.firebaseUid);
      await User.deleteMany({ firebaseUid: { $in: orphanedUids } });
      console.log(`🗑️ Deleted ${orphanedUsers.length} orphaned users from MongoDB`);
      
      // Log deleted users
      orphanedUsers.forEach(user => {
        console.log(`   - ${user.firebaseUid}`);
      });
    }
    
    // 8. Find duplicate emails in MongoDB
    const duplicateEmails = await User.aggregate([
      { $match: { email: { $ne: null, $ne: '' } } },
      { $group: { 
        _id: "$email", 
        count: { $sum: 1 },
        users: { $push: { firebaseUid: "$firebaseUid", _id: "$_id" } }
      }},
      { $match: { count: { $gt: 1 } } }
    ]);
    
    console.log(`🔍 Found ${duplicateEmails.length} duplicate emails`);
    
    // Fix duplicate emails by adding firebaseUid
    for (const dup of duplicateEmails) {
      console.log(`🔄 Fixing duplicate email: ${dup._id}`);
      
      // Keep the first user, update others
      const [keepUser, ...updateUsers] = dup.users;
      
      for (const user of updateUsers) {
        await User.findByIdAndUpdate(user._id, {
          $set: { 
            email: `${user.firebaseUid}_${dup._id}`,
            originalEmail: dup._id
          }
        });
        console.log(`   → Updated ${user.firebaseUid}: ${user.firebaseUid}_${dup._id}`);
      }
    }
    
    console.log('✅ Cleanup completed!');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Cleanup error:', error);
    process.exit(1);
  }
}

cleanupOrphanedUsers();