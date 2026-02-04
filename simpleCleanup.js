const mongoose = require('mongoose');

async function simpleCleanup() {
  try {
    console.log('🚨 SIMPLE DATABASE CLEANUP\n');
    
    // Use the SAME connection as your backend
    // First, let's check if we can connect at all
    console.log('🔍 Trying to connect to MongoDB...');
    
    try {
      // Try default local connection
      await mongoose.connect('mongodb://127.0.0.1:27017/whatsapp_clone', {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 5000,
      });
    } catch (err) {
      console.log('❌ Cannot connect to local MongoDB');
      console.log('💡 Try these solutions:');
      console.log('1. Start MongoDB:');
      console.log('   - Open Command Prompt as Admin and run: net start MongoDB');
      console.log('   - OR: Open Services (services.msc) and start MongoDB Server');
      console.log('');
      console.log('2. If using a different port/connection, update the script');
      console.log('');
      console.log('3. Check if MongoDB is installed:');
      console.log('   - Check C:\\Program Files\\MongoDB\\');
      console.log('');
      return;
    }
    
    console.log('✅ Connected to MongoDB');
    
    // Get all collections
    const collections = await mongoose.connection.db.collections();
    console.log('\n📁 Collections in database:');
    collections.forEach(col => console.log(`   - ${col.collectionName}`));
    
    // Check users collection
    const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
    const users = await User.find({});
    
    console.log(`\n👥 Total users: ${users.length}`);
    
    // Show all users
    console.log('\n📋 ALL USERS:');
    users.forEach((user, index) => {
      console.log(`\n${index + 1}. ${user.name || 'No name'} (${user.email || 'No email'})`);
      console.log(`   ID: ${user._id}`);
      console.log(`   Firebase UID: ${user.firebaseUid || 'No UID'}`);
      console.log(`   Created: ${user.createdAt || 'No date'}`);
    });
    
    // Find duplicates
    console.log('\n🔍 CHECKING FOR DUPLICATES:');
    
    // Group by firebaseUid
    const uidMap = {};
    users.forEach(user => {
      if (user.firebaseUid) {
        if (!uidMap[user.firebaseUid]) uidMap[user.firebaseUid] = [];
        uidMap[user.firebaseUid].push(user);
      }
    });
    
    // Show duplicates
    let hasDuplicates = false;
    Object.keys(uidMap).forEach(uid => {
      if (uidMap[uid].length > 1) {
        hasDuplicates = true;
        console.log(`\n⚠️ DUPLICATE Firebase UID: ${uid}`);
        uidMap[uid].forEach((user, i) => {
          console.log(`   ${i + 1}. ${user.name} - ${user.email} - ID: ${user._id}`);
        });
      }
    });
    
    if (!hasDuplicates) {
      console.log('✅ No duplicate firebaseUids found');
    }
    
    // Group by email
    const emailMap = {};
    users.forEach(user => {
      if (user.email) {
        if (!emailMap[user.email]) emailMap[user.email] = [];
        emailMap[user.email].push(user);
      }
    });
    
    // Show duplicate emails
    Object.keys(emailMap).forEach(email => {
      if (emailMap[email].length > 1) {
        console.log(`\n⚠️ DUPLICATE Email: ${email}`);
        emailMap[email].forEach((user, i) => {
          console.log(`   ${i + 1}. ${user.name} - Firebase: ${user.firebaseUid} - ID: ${user._id}`);
        });
      }
    });
    
    console.log('\n✅ Cleanup check complete');
    console.log('\n💡 If you see duplicates, you can:');
    console.log('1. Delete them manually using MongoDB Compass');
    console.log('2. Run this command in MongoDB shell:');
    console.log('   db.users.deleteOne({_id: ObjectId("DUPLICATE_ID_HERE")})');
    
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

simpleCleanup();