// backend/routes/upload.js - CORRECTED VERSION
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { initializeApp } = require('firebase/app');
const { 
  getStorage, 
  ref, 
  uploadBytesResumable,
  getDownloadURL
} = require('firebase/storage');
const sharp = require('sharp');
const path = require('path');

const router = express.Router();

// ==================== FIREBASE CONFIGURATION ====================
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

// Initialize Firebase
let storage;
try {
  const firebaseApp = initializeApp(firebaseConfig);
  storage = getStorage(firebaseApp);
  console.log('✅ Firebase Storage initialized');
} catch (error) {
  console.error('❌ Firebase initialization failed:', error.message);
  storage = null;
}

// ==================== MULTER CONFIGURATION ====================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = {
      // Images
      'image/jpeg': true,
      'image/jpg': true,
      'image/png': true,
      'image/gif': true,
      'image/webp': true,
      'image/bmp': true,
      'image/heic': true,
      'image/heif': true,
      
      // Videos
      'video/mp4': true,
      'video/mpeg': true,
      'video/quicktime': true,
      'video/x-msvideo': true,
      'video/x-matroska': true,
      'video/webm': true,
      
      // Audio
      'audio/mpeg': true,
      'audio/wav': true,
      'audio/x-wav': true,
      'audio/m4a': true,
      'audio/aac': true,
      'audio/ogg': true,
      
      // Documents
      'application/pdf': true,
      'application/msword': true,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
      'text/plain': true,
      
      // Others
      'application/octet-stream': true,
    };
    
    if (allowedTypes[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}`), false);
    }
  }
});

// ==================== PROGRESS TRACKING STORE ====================
const uploadProgressStore = new Map();

// Clean up old progress entries
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [uploadId, data] of uploadProgressStore.entries()) {
    if (data.timestamp < oneHourAgo) {
      uploadProgressStore.delete(uploadId);
    }
  }
}, 60 * 60 * 1000);

// ==================== HELPER FUNCTIONS ====================
const generateThumbnail = async (imageBuffer, fileName) => {
  try {
    const thumbnailBuffer = await sharp(imageBuffer)
      .resize(200, 200, { fit: 'cover' })
      .jpeg({ quality: 70 })
      .toBuffer();
    
    const thumbnailName = `thumbnails/${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;
    const thumbnailRef = ref(storage, thumbnailName);
    
    const snapshot = await uploadBytesResumable(thumbnailRef, thumbnailBuffer, {
      contentType: 'image/jpeg',
    });
    
    const thumbnailUrl = await getDownloadURL(snapshot.ref);
    return thumbnailUrl;
  } catch (error) {
    console.warn('⚠️ Thumbnail generation failed:', error.message);
    return null;
  }
};

const getImageDimensions = async (imageBuffer) => {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    return {
      width: metadata.width || 0,
      height: metadata.height || 0
    };
  } catch (error) {
    console.warn('⚠️ Image dimension detection failed:', error.message);
    return { width: 0, height: 0 };
  }
};

const getFileType = (mimeType, fileName = '') => {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'text/plain') return 'txt';
  return 'file';
};

const getFileExtension = (fileName) => {
  return path.extname(fileName).toLowerCase().replace('.', '');
};

// ==================== MIDDLEWARE ====================
const validateUpload = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'No file uploaded'
    });
  }
  
  // Check if Firebase is available
  if (!storage) {
    return res.status(503).json({
      success: false,
      message: 'Storage service unavailable'
    });
  }
  
  next();
};

// ==================== ROUTES ====================

// ✅ HEALTH CHECK
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Upload service is running',
    timestamp: new Date().toISOString(),
    firebase: !!storage
  });
});

// ✅ SINGLE FILE UPLOAD WITH PROGRESS TRACKING
router.post('/media', upload.single('file'), validateUpload, async (req, res) => {
  let clientUploadId;
  
  try {
    const file = req.file;
    clientUploadId = req.body.uploadId || `upload_${Date.now()}_${uuidv4().substring(0, 8)}`;
    const chatId = req.body.chatId || 'unknown';
    const userId = req.body.userId || req.user?.uid || 'anonymous';
    const caption = req.body.caption || '';
    const isGrouped = req.body.isGrouped === 'true';
    const batchId = req.body.batchId;
    const fileIndex = req.body.fileIndex;
    
    console.log('📤 Upload request:', {
      uploadId: clientUploadId,
      fileName: file.originalname,
      fileSize: (file.size / 1024 / 1024).toFixed(2) + 'MB',
      chatId: chatId,
      userId: userId,
      isGrouped: isGrouped,
      batchId: batchId,
      fileIndex: fileIndex
    });

    // Validate file buffer
    if (!file.buffer || file.buffer.length === 0) {
      throw new Error('File buffer is empty or invalid');
    }

    // Generate unique filename
    const fileExtension = getFileExtension(file.originalname) || 
                         (file.mimetype.includes('image') ? 'jpg' : 'bin');
    const uniqueFileName = `messages/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExtension}`;
    const storageRef = ref(storage, uniqueFileName);

    // Initialize progress tracking
    uploadProgressStore.set(clientUploadId, {
      progress: 0,
      status: 'starting',
      fileName: file.originalname,
      timestamp: Date.now(),
      ...(batchId && { batchId, fileIndex })
    });

    // Upload with progress tracking
    return new Promise((resolve, reject) => {
      const uploadTask = uploadBytesResumable(storageRef, file.buffer, {
        contentType: file.mimetype,
        customMetadata: {
          originalName: file.originalname,
          uploadedBy: userId,
          uploadId: clientUploadId,
          chatId: chatId,
          caption: caption,
          ...(batchId && { batchId, fileIndex }),
          timestamp: new Date().toISOString()
        }
      });

      uploadTask.on('state_changed',
        // Progress snapshot
        (snapshot) => {
          const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          
          // Update progress store
          uploadProgressStore.set(clientUploadId, {
            progress: progress,
            status: 'uploading',
            fileName: file.originalname,
            bytesTransferred: snapshot.bytesTransferred,
            totalBytes: snapshot.totalBytes,
            timestamp: Date.now(),
            ...(batchId && { batchId, fileIndex })
          });

          console.log(`📊 Progress [${clientUploadId}]: ${progress}%`);
        },
        // Error handler
        (error) => {
          console.error(`❌ Upload failed [${clientUploadId}]:`, error.message);
          
          uploadProgressStore.set(clientUploadId, {
            progress: 0,
            status: 'error',
            fileName: file.originalname,
            error: error.message,
            timestamp: Date.now()
          });
          
          reject(error);
        },
        // Completion handler
        async () => {
          try {
            // Get download URL
            const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
            console.log(`✅ Upload complete [${clientUploadId}]: ${downloadURL.substring(0, 80)}...`);

            // Determine file type
            const fileType = getFileType(file.mimetype, file.originalname);
            
            // Generate thumbnail for images
            let thumbnailUrl = null;
            let dimensions = { width: 0, height: 0 };
            
            if (fileType === 'image') {
              thumbnailUrl = await generateThumbnail(file.buffer, file.originalname);
              dimensions = await getImageDimensions(file.buffer);
            }

            // Mark as complete
            uploadProgressStore.set(clientUploadId, {
              progress: 100,
              status: 'complete',
              fileName: file.originalname,
              fileUrl: downloadURL,
              timestamp: Date.now(),
              ...(batchId && { batchId, fileIndex })
            });

            // Build response
            const responseData = {
              success: true,
              data: {
                // Basic info
                fileUrl: downloadURL,
                fileName: file.originalname,
                messageType: fileType,
                mimeType: file.mimetype,
                fileSize: file.size,
                thumbnailUrl: thumbnailUrl,
                uploadId: clientUploadId,
                
                // Dimensions
                width: dimensions.width,
                height: dimensions.height,
                
                // Metadata
                caption: caption,
                uploadedAt: new Date().toISOString(),
                
                // For grouped media
                ...(batchId && { 
                  batchId: batchId,
                  fileIndex: parseInt(fileIndex) || 0
                })
              }
            };

            res.json(responseData);
            resolve();
          } catch (error) {
            console.error(`❌ Post-upload processing failed [${clientUploadId}]:`, error);
            reject(error);
          }
        }
      );
    }).catch(error => {
      res.status(500).json({
        success: false,
        message: 'Upload failed: ' + error.message,
        uploadId: clientUploadId
      });
    });

  } catch (error) {
    console.error('❌ Upload route error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Upload failed: ' + error.message,
      ...(clientUploadId && { uploadId: clientUploadId })
    });
  }
});

// ✅ PROGRESS POLLING ENDPOINT
router.get('/progress/:uploadId', (req, res) => {
  const { uploadId } = req.params;
  
  if (!uploadProgressStore.has(uploadId)) {
    return res.status(404).json({
      success: false,
      message: 'Upload not found or expired'
    });
  }
  
  const progressData = uploadProgressStore.get(uploadId);
  
  res.json({
    success: true,
    uploadId: uploadId,
    progress: progressData.progress,
    status: progressData.status,
    fileName: progressData.fileName,
    ...(progressData.fileUrl && { fileUrl: progressData.fileUrl }),
    ...(progressData.error && { error: progressData.error }),
    ...(progressData.batchId && { 
      batchId: progressData.batchId,
      fileIndex: progressData.fileIndex
    })
  });
});

// ✅ BATCH PROGRESS ENDPOINT (for grouped media)
router.get('/progress/batch/:batchId', (req, res) => {
  const { batchId } = req.params;
  
  // Collect all files for this batch
  const fileProgress = [];
  let totalProgress = 0;
  let fileCount = 0;
  let completedFiles = 0;
  
  // Find all uploads for this batch
  for (const [uploadId, data] of uploadProgressStore.entries()) {
    if (data.batchId === batchId) {
      fileProgress.push({
        uploadId: uploadId,
        progress: data.progress || 0,
        status: data.status,
        fileName: data.fileName,
        fileIndex: data.fileIndex,
        ...(data.fileUrl && { fileUrl: data.fileUrl })
      });
      
      totalProgress += data.progress || 0;
      fileCount++;
      if (data.progress >= 100) completedFiles++;
    }
  }
  
  if (fileCount === 0) {
    return res.status(404).json({
      success: false,
      message: 'Batch not found or no files uploaded'
    });
  }
  
  const avgProgress = Math.round(totalProgress / fileCount);
  
  res.json({
    success: true,
    batchId: batchId,
    progress: avgProgress,
    totalFiles: fileCount,
    completedFiles: completedFiles,
    fileProgress: fileProgress
  });
});

// ✅ CLEAN UP PROGRESS DATA
router.delete('/progress/:uploadId', (req, res) => {
  const { uploadId } = req.params;
  
  if (uploadProgressStore.delete(uploadId)) {
    res.json({ success: true, message: 'Progress data cleared' });
  } else {
    res.status(404).json({ success: false, message: 'Upload not found' });
  }
});

// ✅ BATCH UPLOAD ENDPOINT (Simplified)
router.post('/media/batch', upload.array('files', 10), async (req, res) => {
  try {
    const files = req.files || [];
    const batchId = req.body.batchId || `batch_${Date.now()}_${uuidv4().substring(0, 8)}`;
    const chatId = req.body.chatId || 'unknown';
    const userId = req.body.userId || req.user?.uid || 'anonymous';
    
    if (files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded'
      });
    }
    
    console.log(`📤 Batch upload started: ${files.length} files`, { batchId });

    const uploadResults = [];
    
    // Store batch info
    uploadProgressStore.set(batchId, {
      progress: 0,
      status: 'starting',
      totalFiles: files.length,
      completedFiles: 0,
      timestamp: Date.now()
    });

    // Upload files sequentially
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileUploadId = `${batchId}_${i}`; // ✅ Match frontend format
      
      console.log(`📤 [${i + 1}/${files.length}] Starting: ${file.originalname}`);
      
      try {
        // Create a mock request for the single upload endpoint
        const mockReq = {
          file: file,
          body: {
            uploadId: fileUploadId,
            chatId: chatId,
            userId: userId,
            isGrouped: 'true',
            batchId: batchId,
            fileIndex: i.toString()
          }
        };
        
        const mockRes = {
          json: (data) => {
            if (data.success) {
              uploadResults.push(data.data);
            }
          }
        };
        
        // Use the same upload logic
        const fileExtension = getFileExtension(file.originalname) || 'bin';
        const uniqueFileName = `messages/${Date.now()}-${i}-${Math.random().toString(36).substring(7)}.${fileExtension}`;
        const storageRef = ref(storage, uniqueFileName);
        
        await new Promise((resolve, reject) => {
          const uploadTask = uploadBytesResumable(storageRef, file.buffer, {
            contentType: file.mimetype,
            customMetadata: {
              originalName: file.originalname,
              uploadedBy: userId,
              batchId: batchId,
              fileIndex: i.toString(),
              chatId: chatId
            }
          });

          uploadTask.on('state_changed',
            (snapshot) => {
              const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
              uploadProgressStore.set(fileUploadId, {
                progress: progress,
                status: 'uploading',
                fileName: file.originalname,
                batchId: batchId,
                fileIndex: i,
                timestamp: Date.now()
              });
            },
            (error) => reject(error),
            async () => {
              try {
                const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                const fileType = getFileType(file.mimetype, file.originalname);
                let thumbnailUrl = null;
                
                if (fileType === 'image') {
                  thumbnailUrl = await generateThumbnail(file.buffer, file.originalname);
                }
                
                uploadProgressStore.set(fileUploadId, {
                  progress: 100,
                  status: 'complete',
                  fileName: file.originalname,
                  fileUrl: downloadURL,
                  thumbnailUrl: thumbnailUrl,
                  batchId: batchId,
                  fileIndex: i,
                  timestamp: Date.now()
                });
                
                uploadResults.push({
                  uri: downloadURL,
                  url: downloadURL,
                  type: fileType,
                  fileName: file.originalname,
                  fileSize: file.size,
                  mimeType: file.mimetype,
                  thumbnailUrl: thumbnailUrl,
                  uploadId: fileUploadId,
                  batchId: batchId,
                  fileIndex: i
                });
                
                resolve();
              } catch (error) {
                reject(error);
              }
            }
          );
        });
        
      } catch (error) {
        console.error(`❌ File ${i + 1} upload failed:`, error.message);
        uploadResults.push({
          fileName: file.originalname,
          success: false,
          error: error.message,
          uploadId: fileUploadId
        });
      }
      
      // Update batch progress
      const completed = uploadResults.filter(r => r.success).length;
      uploadProgressStore.set(batchId, {
        progress: Math.round((completed / files.length) * 100),
        status: 'uploading',
        totalFiles: files.length,
        completedFiles: completed,
        timestamp: Date.now()
      });
      
      // Small delay
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    // Mark batch as complete
    const successfulUploads = uploadResults.filter(r => r.success);
    
    uploadProgressStore.set(batchId, {
      progress: 100,
      status: 'complete',
      totalFiles: files.length,
      completedFiles: successfulUploads.length,
      timestamp: Date.now()
    });
    
    console.log(`✅ Batch upload completed: ${successfulUploads.length}/${files.length} files`);
    
    res.json({
      success: true,
      data: {
        batchId: batchId,
        uploads: successfulUploads,
        totalCount: files.length,
        successfulCount: successfulUploads.length,
        groupedMedia: successfulUploads
      }
    });
    
  } catch (error) {
    console.error('❌ Batch upload failed:', error);
    res.status(500).json({
      success: false,
      message: 'Batch upload failed: ' + error.message
    });
  }
});

// ✅ TEST ENDPOINT
router.post('/test', upload.single('file'), async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Test successful',
      file: req.file ? {
        name: req.file.originalname,
        size: req.file.size,
        type: req.file.mimetype
      } : null
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Test failed: ' + error.message
    });
  }
});

module.exports = router;