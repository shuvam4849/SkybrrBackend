const mongoose = require('mongoose');
require('dotenv').config();

async function cleanupDuplicates() {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp_clone';
    
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');
    
    const db = mongoose.connection.db;
    const users = db.collection('users');
    
    console.log('\n🧹 Cleaning up duplicate null values...');
    
    // 1. Find ALL users with null phone
    const nullPhoneUsers = await users.find({ phone: null }).toArray();
    console.log(`📱 Found ${nullPhoneUsers.length} users with null phone`);
    
    // 2. Find users with empty string phone
    const emptyPhoneUsers = await users.find({ phone: "" }).toArray();
    console.log(`📱 Found ${emptyPhoneUsers.length} users with empty string phone`);
    
    // 3. Update empty strings to null
    if (emptyPhoneUsers.length > 0) {
      const result = await users.updateMany(
        { phone: "" },
        { $set: { phone: null } }
      );
      console.log(`✅ Updated ${result.modifiedCount} empty phones to null`);
    }
    
    // 4. Find duplicate firebaseUid entries
    console.log('\n🔍 Checking for duplicate firebaseUid entries...');
    const duplicates = await users.aggregate([
      { $match: { firebaseUid: { $ne: null } } },
      { $group: { 
        _id: "$firebaseUid", 
        count: { $sum: 1 },
        ids: { $push: "$_id" }
      }},
      { $match: { count: { $gt: 1 } } }
    ]).toArray();
    
    console.log(`Found ${duplicates.length} duplicate firebaseUid entries`);
    
    // 5. Remove duplicates (keep the first one)
    for (const dup of duplicates) {
      const keepId = dup.ids[0];
      const deleteIds = dup.ids.slice(1);
      
      if (deleteIds.length > 0) {
        await users.deleteMany({ _id: { $in: deleteIds } });
        console.log(`🗑️ Removed ${deleteIds.length} duplicates for firebaseUid: ${dup._id}`);
      }
    }
    
    // 6. Check for the problematic user from logs
    console.log('\n🔍 Checking for user: EoruGGnJPQZGH2z6vYfmBGpsT8p1');
    const problemUser = await users.find({ 
      firebaseUid: "EoruGGnJPQZGH2z6vYfmBGpsT8p1" 
    }).toArray();
    
    console.log(`Found ${problemUser.length} entries for this user:`);
    problemUser.forEach((user, i) => {
      console.log(`  ${i+1}. _id: ${user._id}, email: ${user.email}, phone: ${user.phone}`);
    });
    
    // 7. If multiple entries, keep only one
    if (problemUser.length > 1) {
      const keepId = problemUser[0]._id;
      const deleteIds = problemUser.slice(1).map(u => u._id);
      
      await users.deleteMany({ _id: { $in: deleteIds } });
      console.log(`🗑️ Removed ${deleteIds.length} duplicate entries`);
    }
    
    // 8. Final check
    console.log('\n📊 Final counts:');
    const totalUsers = await users.countDocuments();
    const nullPhoneCount = await users.countDocuments({ phone: null });
    const nullEmailCount = await users.countDocuments({ email: null });
    
    console.log(`Total users: ${totalUsers}`);
    console.log(`Users with null phone: ${nullPhoneCount}`);
    console.log(`Users with null email: ${nullEmailCount}`);
    
    console.log('\n🎉 Cleanup completed!');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

cleanupDuplicates();