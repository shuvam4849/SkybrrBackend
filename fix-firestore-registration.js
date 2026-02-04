const admin = require('firebase-admin');
require('dotenv').config();

// Initialize Firebase Admin
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function fixAllUsersRegistration() {
  try {
    console.log('🔄 Fixing registrationCompleted field in Firestore...');
    
    const usersRef = db.collection('users');
    const snapshot = await usersRef.get();
    
    console.log(`📊 Found ${snapshot.size} users`);
    
    const batch = db.batch();
    let count = 0;
    
    snapshot.forEach((doc) => {
      const userRef = usersRef.doc(doc.id);
      const userData = doc.data();
      
      // Only add if registrationCompleted doesn't exist
      if (userData.registrationCompleted === undefined) {
        batch.update(userRef, {
          registrationCompleted: true,
          onboardingCompleted: userData.onboardingCompleted || true,
          firstLogin: userData.firstLogin !== undefined ? userData.firstLogin : false,
          lastUpdated: new Date().toISOString()
        });
        count++;
      }
    });
    
    if (count > 0) {
      await batch.commit();
      console.log(`✅ Updated ${count} users with registrationCompleted: true`);
    } else {
      console.log('✅ All users already have registrationCompleted field');
    }
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixAllUsersRegistration();