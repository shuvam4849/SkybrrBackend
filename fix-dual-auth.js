const mongoose = require('mongoose');
require('dotenv').config();

async function fixDualAuth() {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp_clone';
    
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');
    
    const db = mongoose.connection.db;
    const users = db.collection('users');
    
    console.log('\n🔧 Fixing dual authentication system...');
    
    // 1. Drop current indexes
    try { await users.dropIndex('phone_sparse_unique'); } catch(e) {}
    try { await users.dropIndex('email_sparse_unique'); } catch(e) {}
    try { await users.dropIndex('phone_1'); } catch(e) {}
    try { await users.dropIndex('email_1'); } catch(e) {}
    
    console.log('✅ Dropped old indexes');
    
    // 2. Find all users and categorize
    const allUsers = await users.find({}).toArray();
    
    console.log(`\n📊 Found ${allUsers.length} total users`);
    
    const phoneUsers = allUsers.filter(u => u.phone && u.phone.trim() !== '');
    const emailUsers = allUsers.filter(u => u.email && u.email.trim() !== '');
    const noAuthUsers = allUsers.filter(u => 
      (!u.phone || u.phone.trim() === '') && 
      (!u.email || u.email.trim() === '')
    );
    
    console.log(`📱 Phone users: ${phoneUsers.length}`);
    console.log(`📧 Email users: ${emailUsers.length}`);
    console.log(`❌ Users with no auth: ${noAuthUsers.length}`);
    
    // 3. Fix users with no authentication method
    console.log('\n🔧 Fixing users with no auth method...');
    for (const user of noAuthUsers) {
      // Assign temporary unique values
      await users.updateOne(
        { _id: user._id },
        { 
          $set: { 
            email: `temp_email_${user._id}@temp.com`,
            phone: `temp_phone_${user._id}`
          }
        }
      );
      console.log(`Fixed user ${user._id}`);
    }
    
    // 4. Create new compound indexes
    console.log('\n🔄 Creating new indexes...');
    
    // Sparse unique index for email
    await users.createIndex({ email: 1 }, { 
      unique: true, 
      sparse: true,
      name: "email_unique_sparse"
    });
    
    // Sparse unique index for phone
    await users.createIndex({ phone: 1 }, { 
      unique: true, 
      sparse: true,
      name: "phone_unique_sparse"
    });
    
    console.log('✅ Created new sparse unique indexes');
    
    // 5. Update user documents to ensure uniqueness
    console.log('\n🔄 Ensuring uniqueness...');
    
    // Find duplicate emails
    const emailDups = await users.aggregate([
      { $match: { email: { $ne: null } } },
      { $group: { 
        _id: "$email", 
        count: { $sum: 1 },
        ids: { $push: "$_id" }
      }},
      { $match: { count: { $gt: 1 } } }
    ]).toArray();
    
    for (const dup of emailDups) {
      // Keep first, update rest with unique email
      const keepId = dup.ids[0];
      const updateIds = dup.ids.slice(1);
      
      for (let i = 0; i < updateIds.length; i++) {
        const newEmail = `${dup._id.split('@')[0]}_${i}@${dup._id.split('@')[1] || 'fixed.com'}`;
        await users.updateOne(
          { _id: updateIds[i] },
          { $set: { email: newEmail } }
        );
      }
    }
    
    // Find duplicate phones
    const phoneDups = await users.aggregate([
      { $match: { phone: { $ne: null } } },
      { $group: { 
        _id: "$phone", 
        count: { $sum: 1 },
        ids: { $push: "$_id" }
      }},
      { $match: { count: { $gt: 1 } } }
    ]).toArray();
    
    for (const dup of phoneDups) {
      // Keep first, update rest with unique phone
      const keepId = dup.ids[0];
      const updateIds = dup.ids.slice(1);
      
      for (let i = 0; i < updateIds.length; i++) {
        const newPhone = `${dup._id}_${i}`;
        await users.updateOne(
          { _id: updateIds[i] },
          { $set: { phone: newPhone } }
        );
      }
    }
    
    console.log('\n🎉 Dual auth system fixed!');
    console.log('Restart your server and test registration with both phone and email.');
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixDualAuth();