// backend/routes/upload.js - COMPLETE WITH REAL PROGRESS TRACKING
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { initializeApp } = require('firebase/app');
const { 
  getStorage, 
  ref, 
  uploadBytesResumable,  // ✅ CHANGED for progress tracking
  getDownloadURL,
  uploadBytes 
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
      cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: images, videos, audio, PDF`), false);
    }
  }
});

// ==================== PROGRESS TRACKING STORE ====================
// Store upload progress in memory (for polling)
const uploadProgressStore = new Map();

// Clean up old progress entries every hour
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [uploadId, data] of uploadProgressStore.entries()) {
    if (data.timestamp < oneHourAgo) {
      uploadProgressStore.delete(uploadId);
      console.log(`🧹 Cleaned up old progress: ${uploadId}`);
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
    
    await uploadBytes(thumbnailRef, thumbnailBuffer, {
      contentType: 'image/jpeg',
    });
    
    const thumbnailUrl = await getDownloadURL(thumbnailRef);
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
    firebase: !!storage,
    maxFileSize: '50MB',
    features: ['single-upload', 'progress-tracking', 'thumbnails']
  });
});

// ✅ SINGLE FILE UPLOAD WITH REAL PROGRESS TRACKING
router.post('/media', upload.single('file'), validateUpload, async (req, res) => {
  try {
    const file = req.file;
    const clientUploadId = req.body.uploadId || `upload_${Date.now()}_${uuidv4().substring(0, 8)}`;
    const chatId = req.body.chatId || 'unknown';
    const userId = req.body.userId || req.user?.uid || 'anonymous';
    const caption = req.body.caption || '';
    
    console.log('📤 Starting upload with progress tracking:', {
      uploadId: clientUploadId,
      fileName: file.originalname,
      fileSize: file.size,
      chatId: chatId,
      userId: userId
    });

    // ✅ FIX: Log the actual file buffer info
    console.log('📊 File buffer info:', {
      hasBuffer: !!file.buffer,
      bufferLength: file.buffer?.length,
      mimetype: file.mimetype
    });

    if (!file.buffer || file.buffer.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'File buffer is empty or invalid',
        uploadId: clientUploadId
      });
    }

    // Generate unique filename for Firebase
    const fileExtension = getFileExtension(file.originalname) || 'bin';
    const uniqueFileName = `messages/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExtension}`;
    const storageRef = ref(storage, uniqueFileName);

    // ✅ INITIAL PROGRESS UPDATE
    uploadProgressStore.set(clientUploadId, {
      progress: 0,
      status: 'starting',
      fileName: file.originalname,
      timestamp: Date.now()
    });

    // Send initial progress via Socket.IO if available
    if (req.io) {
      req.io.emit('uploadProgress', {
        uploadId: clientUploadId,
        progress: 0,
        status: 'starting',
        fileName: file.originalname,
        fileSize: file.size
      });
    }

    return new Promise((resolve) => {
      // ✅ USE UPLOAD BYTES RESUMABLE FOR PROGRESS TRACKING
      const uploadTask = uploadBytesResumable(storageRef, file.buffer, {
        contentType: file.mimetype,
        customMetadata: {
          originalName: file.originalname,
          uploadedBy: userId,
          uploadId: clientUploadId,
          chatId: chatId,
          caption: caption,
          timestamp: new Date().toISOString()
        }
      });

      // ✅ REAL-TIME PROGRESS LISTENER
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
            timestamp: Date.now()
          });

          console.log(`🔥 REAL FIREBASE PROGRESS [${clientUploadId}]: ${progress}%`);

          // Send progress via Socket.IO
          if (req.io) {
            req.io.emit('uploadProgress', {
              uploadId: clientUploadId,
              progress: progress,
              status: 'uploading',
              fileName: file.originalname,
              bytesTransferred: snapshot.bytesTransferred,
              totalBytes: snapshot.totalBytes
            });
          }
        },
        // Error handler
        (error) => {
          console.error(`❌ Upload failed [${clientUploadId}]:`, error);

          uploadProgressStore.set(clientUploadId, {
            progress: 0,
            status: 'error',
            fileName: file.originalname,
            error: error.message,
            timestamp: Date.now()
          });

          if (req.io) {
            req.io.emit('uploadProgress', {
              uploadId: clientUploadId,
              progress: 0,
              status: 'error',
              fileName: file.originalname,
              error: error.message
            });
          }

          res.status(500).json({
            success: false,
            message: 'Upload failed: ' + error.message,
            uploadId: clientUploadId
          });
          resolve();
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

            // Mark as complete in progress store
            uploadProgressStore.set(clientUploadId, {
              progress: 100,
              status: 'complete',
              fileName: file.originalname,
              fileUrl: downloadURL,
              timestamp: Date.now()
            });

            // Send completion via Socket.IO
            if (req.io) {
              req.io.emit('uploadProgress', {
                uploadId: clientUploadId,
                progress: 100,
                status: 'complete',
                fileName: file.originalname,
                fileUrl: downloadURL
              });
            }

            // Response
            res.json({
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
                
                // Grouped media format
                formattedForGroupedMedia: {
                  uri: downloadURL,
                  url: downloadURL,
                  type: fileType,
                  fileName: file.originalname,
                  fileSize: file.size,
                  mimeType: file.mimetype,
                  thumbnailUrl: thumbnailUrl,
                  width: dimensions.width,
                  height: dimensions.height,
                  caption: caption,
                  uploadedAt: new Date().toISOString()
                }
              }
            });
            
            resolve();
          } catch (error) {
            console.error(`❌ Post-upload processing failed [${clientUploadId}]:`, error);
            
            res.status(500).json({
              success: false,
              message: 'Upload completed but processing failed: ' + error.message,
              uploadId: clientUploadId
            });
            resolve();
          }
        }
      );
    });

  } catch (error) {
    console.error('❌ Upload route error:', error);
    res.status(500).json({
      success: false,
      message: 'Upload failed: ' + error.message
    });
  }
});

// ✅ PROGRESS POLLING ENDPOINT (For clients without WebSocket)
router.get('/progress/:uploadId', (req, res) => {
  const { uploadId } = req.params;
  
  if (!uploadProgressStore.has(uploadId)) {
    return res.status(404).json({
      success: false,
      message: 'Upload not found or expired'
    });
  }
  
  const progressData = uploadProgressStore.get(uploadId);
  
  // Clean up completed uploads older than 5 minutes
  if (progressData.status === 'complete' && Date.now() - progressData.timestamp > 5 * 60 * 1000) {
    uploadProgressStore.delete(uploadId);
  }
  
  res.json({
    success: true,
    uploadId: uploadId,
    progress: progressData.progress,
    status: progressData.status,
    fileName: progressData.fileName,
    ...(progressData.fileUrl && { fileUrl: progressData.fileUrl }),
    ...(progressData.error && { error: progressData.error })
  });
});

// ✅ BATCH PROGRESS ENDPOINT
router.get('/progress/batch/:batchId', (req, res) => {
  const { batchId } = req.params;
  
  // Check if batch exists
  const batchData = uploadProgressStore.get(batchId);
  if (!batchData) {
    return res.status(404).json({
      success: false,
      message: 'Batch not found or expired'
    });
  }
  
  // Get all individual file progress for this batch
  const fileProgress = [];
  for (let i = 0; i < (batchData.totalFiles || 0); i++) {
    const fileUploadId = `${batchId}_file_${i}`;
    const fileData = uploadProgressStore.get(fileUploadId);
    if (fileData) {
      fileProgress.push({
        fileIndex: i,
        uploadId: fileUploadId,
        progress: fileData.progress,
        status: fileData.status,
        fileName: fileData.fileName,
        ...(fileData.fileUrl && { fileUrl: fileData.fileUrl })
      });
    }
  }
  
  // Calculate overall progress
  const totalProgress = fileProgress.reduce((sum, file) => sum + (file.progress || 0), 0);
  const avgProgress = fileProgress.length > 0 ? Math.round(totalProgress / fileProgress.length) : 0;
  const completedFiles = fileProgress.filter(f => f.progress >= 100).length;
  
  res.json({
    success: true,
    batchId: batchId,
    progress: avgProgress,
    status: batchData.status,
    totalFiles: batchData.totalFiles,
    completedFiles: completedFiles,
    fileProgress: fileProgress,
    timestamp: batchData.timestamp
  });
});

// ✅ CLEAN UP PROGRESS DATA
router.delete('/progress/:uploadId', (req, res) => {
  const { uploadId } = req.params;
  
  if (uploadProgressStore.delete(uploadId)) {
    console.log(`🧹 Cleared progress data for: ${uploadId}`);
    res.json({ success: true, message: 'Progress data cleared' });
  } else {
    res.status(404).json({ success: false, message: 'Upload not found' });
  }
});

// ✅ BATCH UPLOAD FOR GROUPED MEDIA WITH INDIVIDUAL FILE PROGRESS TRACKING
router.post('/media/batch', upload.array('files', 10), async (req, res) => {
  try {
    const files = req.files || [];
    const batchId = req.body.batchId || `batch_${Date.now()}_${uuidv4().substring(0, 8)}`;
    const chatId = req.body.chatId || 'unknown';
    const userId = req.body.userId || req.user?.uid || 'anonymous';
    const captions = JSON.parse(req.body.captions || '[]');
    
    if (files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded'
      });
    }
    
    console.log(`📤📦 Batch upload started: ${files.length} files`, { batchId, chatId });

    // ✅ Store BATCH progress (overall)
    uploadProgressStore.set(batchId, {
      progress: 0,
      status: 'starting',
      totalFiles: files.length,
      completedFiles: 0,
      timestamp: Date.now()
    });

    // ✅ Send initial batch progress
    if (req.io) {
      req.io.emit('batchUploadProgress', {
        batchId: batchId,
        progress: 0,
        status: 'starting',
        totalFiles: files.length,
        completedFiles: 0
      });
    }

    const uploadResults = [];
    
    // ✅ Upload files SEQUENTIALLY with real progress tracking
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileCaption = captions[i] || '';
      const fileUploadId = `${batchId}_file_${i}`;
      
      console.log(`📤 [${i + 1}/${files.length}] Starting upload: ${file.originalname}`);
      
      // ✅ Set initial progress for THIS individual file
      uploadProgressStore.set(fileUploadId, {
        progress: 0,
        status: 'starting',
        fileName: file.originalname,
        batchId: batchId,
        fileIndex: i,
        timestamp: Date.now()
      });
      
      // ✅ Send initial progress for THIS file
      if (req.io) {
        req.io.emit('uploadProgress', {
          uploadId: fileUploadId,
          progress: 0,
          status: 'starting',
          fileName: file.originalname,
          batchId: batchId,
          fileIndex: i,
          isGrouped: true
        });
      }

      try {
        // Generate unique filename
        const fileExtension = getFileExtension(file.originalname) || 'bin';
        const uniqueFileName = `messages/${Date.now()}-${i}-${Math.random().toString(36).substring(7)}.${fileExtension}`;
        const storageRef = ref(storage, uniqueFileName);

        // ✅ USE UPLOAD BYTES RESUMABLE FOR REAL PROGRESS TRACKING
        await new Promise((resolve, reject) => {
          const uploadTask = uploadBytesResumable(storageRef, file.buffer, {
            contentType: file.mimetype,
            customMetadata: {
              originalName: file.originalname,
              uploadedBy: userId,
              batchId: batchId,
              fileIndex: i.toString(),
              caption: fileCaption,
              chatId: chatId
            }
          });

          // ✅ REAL-TIME PROGRESS LISTENER FOR EACH FILE
          uploadTask.on('state_changed',
            (snapshot) => {
              const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
              
              // ✅ Update INDIVIDUAL file progress
              uploadProgressStore.set(fileUploadId, {
                progress: progress,
                status: 'uploading',
                fileName: file.originalname,
                bytesTransferred: snapshot.bytesTransferred,
                totalBytes: snapshot.totalBytes,
                batchId: batchId,
                fileIndex: i,
                timestamp: Date.now()
              });

              console.log(`🔥 FILE ${i} REAL PROGRESS [${fileUploadId}]: ${progress}%`);

              // ✅ Send INDIVIDUAL file progress via Socket.IO
              if (req.io) {
                req.io.emit('uploadProgress', {
                  uploadId: fileUploadId,
                  progress: progress,
                  status: 'uploading',
                  fileName: file.originalname,
                  batchId: batchId,
                  fileIndex: i,
                  isGrouped: true,
                  bytesTransferred: snapshot.bytesTransferred,
                  totalBytes: snapshot.totalBytes
                });
              }

              // ✅ Calculate and update BATCH progress
              const batchData = uploadProgressStore.get(batchId);
              if (batchData) {
                // Calculate overall progress based on all files
                let totalProgress = 0;
                let completedCount = 0;
                
                for (let j = 0; j < files.length; j++) {
                  const fid = `${batchId}_file_${j}`;
                  const fileData = uploadProgressStore.get(fid);
                  if (fileData) {
                    totalProgress += fileData.progress || 0;
                    if (fileData.progress >= 100) completedCount++;
                  }
                }
                
                const avgProgress = Math.round(totalProgress / files.length);
                
                // Update batch progress
                uploadProgressStore.set(batchId, {
                  progress: avgProgress,
                  status: 'uploading',
                  totalFiles: files.length,
                  completedFiles: completedCount,
                  timestamp: Date.now()
                });

                // Send batch progress
                if (req.io) {
                  req.io.emit('batchUploadProgress', {
                    batchId: batchId,
                    progress: avgProgress,
                    status: 'uploading',
                    totalFiles: files.length,
                    completedFiles: completedCount,
                    currentFile: i + 1
                  });
                }
              }
            },
            (error) => {
              console.error(`❌ File ${i + 1} upload failed:`, error);
              
              uploadProgressStore.set(fileUploadId, {
                progress: 0,
                status: 'error',
                fileName: file.originalname,
                error: error.message,
                batchId: batchId,
                fileIndex: i,
                timestamp: Date.now()
              });
              
              reject(error);
            },
            async () => {
              try {
                // Get download URL
                const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                
                // Determine file type
                const fileType = getFileType(file.mimetype, file.originalname);
                
                // Generate thumbnail for images
                let thumbnailUrl = null;
                if (fileType === 'image') {
                  thumbnailUrl = await generateThumbnail(file.buffer, file.originalname);
                }
                
                // ✅ Mark file as complete
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
                
                // ✅ Send completion for THIS file
                if (req.io) {
                  req.io.emit('uploadProgress', {
                    uploadId: fileUploadId,
                    progress: 100,
                    status: 'complete',
                    fileName: file.originalname,
                    fileUrl: downloadURL,
                    thumbnailUrl: thumbnailUrl,
                    batchId: batchId,
                    fileIndex: i,
                    isGrouped: true
                  });
                }
                
                // Add to results
                uploadResults.push({
                  uri: downloadURL,
                  url: downloadURL,
                  type: fileType,
                  fileName: file.originalname,
                  fileSize: file.size,
                  mimeType: file.mimetype,
                  thumbnailUrl: thumbnailUrl,
                  caption: fileCaption,
                  uploadedAt: new Date().toISOString(),
                  success: true,
                  uploadId: fileUploadId
                });
                
                console.log(`✅ File ${i + 1} uploaded successfully: ${downloadURL.substring(0, 50)}...`);
                
                resolve();
              } catch (error) {
                reject(error);
              }
            }
          );
        });
        
      } catch (error) {
        console.error(`❌ Failed to upload file ${i + 1}:`, error.message);
        
        uploadProgressStore.set(fileUploadId, {
          progress: 0,
          status: 'error',
          fileName: file.originalname,
          error: error.message,
          batchId: batchId,
          fileIndex: i,
          timestamp: Date.now()
        });
        
        uploadResults.push({
          fileName: file.originalname,
          success: false,
          error: error.message,
          uploadId: fileUploadId
        });
      }
      
      // Small delay between files
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    // ✅ Mark batch as complete
    const successfulUploads = uploadResults.filter(r => r.success);
    
    uploadProgressStore.set(batchId, {
      progress: 100,
      status: 'complete',
      totalFiles: files.length,
      completedFiles: successfulUploads.length,
      timestamp: Date.now()
    });
    
    // ✅ Send final batch completion
    if (req.io) {
      req.io.emit('batchUploadProgress', {
        batchId: batchId,
        progress: 100,
        status: 'complete',
        totalFiles: files.length,
        completedFiles: successfulUploads.length
      });
    }
    
    console.log(`✅ Batch upload completed: ${successfulUploads.length}/${files.length} files successful`);
    
    res.json({
      success: true,
      data: {
        batchId: batchId,
        uploads: successfulUploads,
        totalCount: files.length,
        successfulCount: successfulUploads.length,
        failedCount: uploadResults.length - successfulUploads.length,
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

// ✅ TEST UPLOAD ENDPOINT
router.post('/test', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No test file provided'
      });
    }
    
    res.json({
      success: true,
      message: 'Test upload successful',
      fileInfo: {
        name: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        encoding: req.file.encoding
      },
      serverTime: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Test upload failed: ' + error.message
    });
  }
});

module.exports = router;