const { MongoClient } = require('mongodb');

async function fixIndexes() {
  const uri = 'mongodb+srv://ssshuvam11:8492948205@myapp.ozuqqgu.mongodb.net/whatsapp_clone?retryWrites=true&w=majority';
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    const db = client.db('whatsapp_clone');
    const users = db.collection('users');
    
    // List current indexes
    console.log('\n📊 Current indexes:');
    const indexes = await users.indexes();
    console.log(indexes.map(idx => ({
      name: idx.name,
      key: idx.key,
      unique: idx.unique || false,
      sparse: idx.sparse || false
    })));
    
    // Drop problematic phone indexes
    console.log('\n🗑️ Removing phone indexes...');
    const phoneIndexes = indexes.filter(idx => 
      idx.name.includes('phone') || Object.keys(idx.key).includes('phone')
    );
    
    for (const idx of phoneIndexes) {
      try {
        await users.dropIndex(idx.name);
        console.log(`✅ Dropped: ${idx.name}`);
      } catch (err) {
        if (err.codeName !== 'IndexNotFound') {
          console.log(`⚠️ Couldn't drop ${idx.name}:`, err.message);
        }
      }
    }
    
    // Create new sparse index
    console.log('\n🔄 Creating sparse phone index...');
    await users.createIndex({ phone: 1 }, { 
      unique: true, 
      sparse: true,
      name: "phone_sparse_unique" 
    });
    console.log('✅ Created sparse phone index');
    
    // Do the same for email
    console.log('\n🗑️ Removing email indexes...');
    const emailIndexes = indexes.filter(idx => 
      idx.name.includes('email') || Object.keys(idx.key).includes('email')
    );
    
    for (const idx of emailIndexes) {
      try {
        await users.dropIndex(idx.name);
        console.log(`✅ Dropped: ${idx.name}`);
      } catch (err) {
        if (err.codeName !== 'IndexNotFound') {
          console.log(`⚠️ Couldn't drop ${idx.name}:`, err.message);
        }
      }
    }
    
    console.log('\n🔄 Creating sparse email index...');
    await users.createIndex({ email: 1 }, { 
      unique: true, 
      sparse: true,
      name: "email_sparse_unique" 
    });
    console.log('✅ Created sparse email index');
    
    // Final verification
    console.log('\n🎉 Final indexes:');
    const finalIndexes = await users.indexes();
    console.log(finalIndexes.map(idx => ({
      name: idx.name,
      key: idx.key,
      unique: idx.unique || false,
      sparse: idx.sparse || false
    })));
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
  }
}

fixIndexes();