const admin = require('firebase-admin');

let firestore = null;
let auth = null;

function initializeFirebase() {
  if (!admin.apps.length) {
    try {
      if (process.env.FIREBASE_PRIVATE_KEY) {
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
          })
        });
        console.log('✅ Firebase Admin initialized successfully');
      } else {
        console.log('⚠️ Firebase Admin not initialized - missing env variables');
        return null;
      }
    } catch (error) {
      console.log('❌ Firebase Admin init error:', error.message);
      return null;
    }
  }
  
  // Initialize Firestore and Auth only once
  if (!firestore) {
    firestore = admin.firestore();
    auth = admin.auth();
  }
  
  return { admin, firestore, auth };
}

module.exports = {
  getAdmin: () => {
    if (!admin.apps.length) {
      return initializeFirebase()?.admin;
    }
    return admin;
  },
  
  getFirestore: () => {
    if (!firestore) {
      initializeFirebase();
    }
    return firestore;
  },
  
  getAuth: () => {
    if (!auth) {
      initializeFirebase();
    }
    return auth;
  },
  
  isInitialized: () => admin.apps.length > 0
};