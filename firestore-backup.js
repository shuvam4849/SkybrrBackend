// firestore-backup.js
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function backupFirestore() {
  const backupDir = path.join(__dirname, 'firestore-backup', new Date().toISOString().split('T')[0]);
  
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  
  console.log(`📦 Creating backup in: ${backupDir}`);
  
  const collections = await db.listCollections();
  
  for (const collectionRef of collections) {
    const snapshot = await collectionRef.get();
    const data = [];
    
    snapshot.forEach(doc => {
      data.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    const filePath = path.join(backupDir, `${collectionRef.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    
    console.log(`✅ Backed up ${collectionRef.id}: ${data.length} documents`);
  }
  
  console.log(`🎉 Backup completed! Location: ${backupDir}`);
}

backupFirestore().catch(console.error);