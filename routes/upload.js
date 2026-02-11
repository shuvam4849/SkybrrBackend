// backend/routes/upload.js - UPDATED WITH CANCELLATION SUPPORT
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

// ==================== UPLOAD TRACKING STORES ====================
const uploadProgressStore = new Map();
const activeUploadTasks = new Map(); // 🔴 NEW: Track Firebase upload tasks for cancellation

// Clean up old progress entries
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  let cleanedProgress = 0;
  let cleanedTasks = 0;
  
  // Clean progress store
  for (const [uploadId, data] of uploadProgressStore.entries()) {
    if (data.timestamp < oneHourAgo) {
      uploadProgressStore.delete(uploadId);
      cleanedProgress++;
    }
  }
  
  // Clean active tasks
  for (const [uploadId, task] of activeUploadTasks.entries()) {
    const progressData = uploadProgressStore.get(uploadId);
    if (!progressData || progressData.timestamp < oneHourAgo) {
      try {
        if (task && typeof task.cancel === 'function') {
          console.log(`🧹 Auto-cancelling stale task: ${uploadId}`);
          task.cancel();
        }
      } catch (error) {
        // Ignore errors for stale tasks
      }
      activeUploadTasks.delete(uploadId);
      cleanedTasks++;
    }
  }
  
  if (cleanedProgress > 0 || cleanedTasks > 0) {
    console.log(`🧹 Cleanup: ${cleanedProgress} progress entries, ${cleanedTasks} stale tasks removed`);
  }
}, 5 * 60 * 1000); // Run every 5 minutes

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
    firebase: !!storage,
    activeUploads: activeUploadTasks.size,
    trackedProgress: uploadProgressStore.size
  });
});

// ==================== CANCELLATION ENDPOINTS ====================

// ✅ GET ALL ACTIVE UPLOADS (DEBUG)
router.get('/active', (req, res) => {
  const activeUploads = [];
  
  for (const [uploadId, task] of activeUploadTasks.entries()) {
    const progressData = uploadProgressStore.get(uploadId);
    activeUploads.push({
      uploadId,
      hasTask: !!task,
      canCancel: task && typeof task.cancel === 'function',
      progressData: progressData || null
    });
  }
  
  res.json({
    success: true,
    activeUploads,
    totalActive: activeUploadTasks.size
  });
});

// ✅ STATUS CHECK ENDPOINT
router.get('/status/:uploadId', (req, res) => {
  const { uploadId } = req.params;
  
  console.log(`🔍 Checking status for: ${uploadId}`);
  
  const uploadTask = activeUploadTasks.get(uploadId);
  const progressData = uploadProgressStore.get(uploadId);
  
  console.log(`🔍 Status check results:`, {
    hasTask: !!uploadTask,
    hasProgressData: !!progressData,
    progress: progressData?.progress || 0,
    status: progressData?.status || 'unknown'
  });
  
  if (!uploadTask && !progressData) {
    return res.status(404).json({
      success: false,
      message: 'Upload not found',
      isActive: false
    });
  }
  
  res.json({
    success: true,
    isActive: !!uploadTask,
    canBeCancelled: !!uploadTask,
    progressData: progressData || null,
    uploadId: uploadId
  });
});

// ✅ CANCEL UPLOAD ENDPOINT
router.post('/cancel', (req, res) => {
  const { uploadId, batchId, fileIndex } = req.body;
  
  console.log('🛑 ========== CANCELLATION REQUEST ==========');
  console.log('🛑 Request body:', { uploadId, batchId, fileIndex });
  console.log(`🛑 Before cancellation - Active tasks: ${activeUploadTasks.size}`);
  console.log(`🛑 Before cancellation - Tracked progress: ${uploadProgressStore.size}`);
  
  let cancelledCount = 0;
  let cancelledUploads = [];
  
  try {
    // CASE 1: Cancel specific upload by uploadId
    if (uploadId) {
      console.log(`🛑 Looking for uploadId: ${uploadId}`);
      
      const uploadTask = activeUploadTasks.get(uploadId);
      const progressData = uploadProgressStore.get(uploadId);
      
      console.log(`🛑 Found task: ${!!uploadTask}, progress data: ${!!progressData}`);
      
      if (uploadTask) {
        try {
          console.log(`🛑 Attempting to cancel Firebase task for: ${uploadId}`);
          
          // Call Firebase's cancel() method
          uploadTask.cancel();
          
          // Clean up tracking
          activeUploadTasks.delete(uploadId);
          uploadProgressStore.delete(uploadId);
          
          cancelledCount++;
          cancelledUploads.push({ uploadId, type: 'single' });
          
          console.log(`✅ Successfully cancelled: ${uploadId}`);
        } catch (cancelError) {
          console.error(`❌ Error cancelling ${uploadId}:`, cancelError.message);
          // Still remove from tracking even if cancel fails
          activeUploadTasks.delete(uploadId);
          uploadProgressStore.delete(uploadId);
        }
      } else {
        console.log(`⚠️ No active task found for: ${uploadId}`);
        // Still remove from progress store if exists
        if (uploadProgressStore.has(uploadId)) {
          uploadProgressStore.delete(uploadId);
          console.log(`🗑️ Removed from progress store: ${uploadId}`);
        }
      }
    }
    
    // CASE 2: Cancel entire batch
    if (batchId && !uploadId) {
      console.log(`🛑 Cancelling entire batch: ${batchId}`);
      
      // Find all tasks for this batch
      for (const [taskId, uploadTask] of activeUploadTasks.entries()) {
        const progressData = uploadProgressStore.get(taskId);
        const isBatchTask = progressData && progressData.batchId === batchId;
        
        console.log(`🛑 Checking task ${taskId}: isBatchTask=${isBatchTask}`);
        
        if (isBatchTask) {
          try {
            console.log(`🛑 Cancelling batch task: ${taskId}`);
            uploadTask.cancel();
            activeUploadTasks.delete(taskId);
            uploadProgressStore.delete(taskId);
            cancelledCount++;
            cancelledUploads.push({ uploadId: taskId, type: 'batch', batchId });
          } catch (error) {
            console.error(`❌ Error cancelling batch task ${taskId}:`, error.message);
          }
        }
      }
      
      // Also remove batch progress entry
      if (uploadProgressStore.has(batchId)) {
        uploadProgressStore.delete(batchId);
        console.log(`🗑️ Removed batch progress entry: ${batchId}`);
      }
    }
    
    // CASE 3: Cancel specific file in batch
    if (batchId && fileIndex !== undefined) {
      const fileUploadId = `${batchId}_${fileIndex}`;
      console.log(`🛑 Cancelling specific file in batch: ${fileUploadId}`);
      
      const uploadTask = activeUploadTasks.get(fileUploadId);
      if (uploadTask) {
        try {
          uploadTask.cancel();
          activeUploadTasks.delete(fileUploadId);
          uploadProgressStore.delete(fileUploadId);
          cancelledCount++;
          cancelledUploads.push({ 
            uploadId: fileUploadId, 
            type: 'batch-file', 
            batchId, 
            fileIndex 
          });
          console.log(`✅ Cancelled file ${fileIndex} in batch ${batchId}`);
        } catch (error) {
          console.error(`❌ Error cancelling file ${fileIndex}:`, error.message);
        }
      }
    }
    
    console.log(`🛑 After cancellation - Active tasks: ${activeUploadTasks.size}`);
    console.log(`🛑 After cancellation - Tracked progress: ${uploadProgressStore.size}`);
    console.log(`🛑 Total cancelled: ${cancelledCount}`);
    console.log('🛑 ========== CANCELLATION COMPLETE ==========\n');
    
    if (cancelledCount > 0) {
      res.json({
        success: true,
        message: `Successfully cancelled ${cancelledCount} upload(s)`,
        cancelledCount,
        cancelledUploads
      });
    } else {
      res.json({
        success: true,
        message: 'No active uploads found to cancel',
        cancelledCount: 0,
        note: 'This may mean the upload was already completed or failed'
      });
    }
    
  } catch (error) {
    console.error('❌ Error in cancellation endpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel upload: ' + error.message
    });
  }
});

// ✅ SINGLE FILE UPLOAD WITH CANCELLATION SUPPORT
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
    
    console.log('📤 ========== UPLOAD START ==========');
    console.log('📤 Upload ID:', clientUploadId);
    console.log('📤 File:', file.originalname, `(${(file.size / 1024 / 1024).toFixed(2)}MB)`);
    console.log('📤 Batch info:', { isGrouped, batchId, fileIndex });
    
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
      bytesTransferred: 0,
      totalBytes: file.size,
      ...(batchId && { batchId, fileIndex }),
      chatId,
      userId
    });

    console.log(`📤 Progress tracking initialized for: ${clientUploadId}`);
    
    // Upload with progress tracking
    return new Promise((resolve, reject) => {
      console.log(`📤 Creating Firebase upload task for: ${clientUploadId}`);
      
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
      
      // 🔴 CRITICAL: Save the upload task for possible cancellation
      console.log(`📤 Saving upload task to activeUploadTasks: ${clientUploadId}`);
      activeUploadTasks.set(clientUploadId, uploadTask);
      console.log(`📤 Active tasks count: ${activeUploadTasks.size}`);

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
            ...(batchId && { batchId, fileIndex }),
            chatId,
            userId
          });

          console.log(`📊 Progress [${clientUploadId}]: ${progress}% (${snapshot.bytesTransferred}/${snapshot.totalBytes} bytes)`);
        },
        // Error handler
        (error) => {
          console.error(`❌ Upload failed [${clientUploadId}]:`, error.message);
          
          // Clean up tracking on error
          activeUploadTasks.delete(clientUploadId);
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
              console.log(`🖼️ Generating thumbnail for: ${clientUploadId}`);
              thumbnailUrl = await generateThumbnail(file.buffer, file.originalname);
              dimensions = await getImageDimensions(file.buffer);
            }

            // 🔴 Clean up - remove from active tasks
            console.log(`📤 Removing completed task from activeUploadTasks: ${clientUploadId}`);
            activeUploadTasks.delete(clientUploadId);
            
            // Mark as complete in progress store
            uploadProgressStore.set(clientUploadId, {
              progress: 100,
              status: 'complete',
              fileName: file.originalname,
              fileUrl: downloadURL,
              thumbnailUrl: thumbnailUrl,
              width: dimensions.width,
              height: dimensions.height,
              timestamp: Date.now(),
              ...(batchId && { batchId, fileIndex })
            });

            console.log(`✅ Upload processing complete for: ${clientUploadId}`);
            console.log(`📤 Active tasks remaining: ${activeUploadTasks.size}`);

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
            
            // Clean up on post-processing error
            activeUploadTasks.delete(clientUploadId);
            reject(error);
          }
        }
      );
      
      // Handle Firebase cancellation
      uploadTask.then().catch((error) => {
        if (error.code === 'storage/canceled') {
          console.log(`🛑 Upload cancelled by Firebase [${clientUploadId}]`);
          
          // Clean up tracking
          activeUploadTasks.delete(clientUploadId);
          uploadProgressStore.delete(clientUploadId);
          
          if (!res.headersSent) {
            res.status(499).json({ // 499 Client Closed Request
              success: false,
              message: 'Upload cancelled by client',
              uploadId: clientUploadId,
              cancelled: true
            });
          }
        }
      });
      
    }).catch(error => {
      // Clean up on general error
      if (clientUploadId) {
        activeUploadTasks.delete(clientUploadId);
      }
      
      console.error(`❌ Upload route error for ${clientUploadId}:`, error.message);
      res.status(500).json({
        success: false,
        message: 'Upload failed: ' + error.message,
        uploadId: clientUploadId
      });
    });

  } catch (error) {
    console.error('❌ Upload route setup error:', error.message);
    
    // Clean up on setup error
    if (clientUploadId) {
      activeUploadTasks.delete(clientUploadId);
      uploadProgressStore.delete(clientUploadId);
    }
    
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
  
  console.log(`🔍 Progress check for: ${uploadId}`);
  
  if (!uploadProgressStore.has(uploadId)) {
    console.log(`❌ Progress not found: ${uploadId}`);
    return res.status(404).json({
      success: false,
      message: 'Upload not found or expired'
    });
  }
  
  const progressData = uploadProgressStore.get(uploadId);
  const isActive = activeUploadTasks.has(uploadId);
  
  console.log(`📊 Progress for ${uploadId}: ${progressData.progress}%, active: ${isActive}, status: ${progressData.status}`);
  
  res.json({
    success: true,
    uploadId: uploadId,
    progress: progressData.progress,
    status: progressData.status,
    fileName: progressData.fileName,
    isActive: isActive,
    ...(progressData.fileUrl && { fileUrl: progressData.fileUrl }),
    ...(progressData.thumbnailUrl && { thumbnailUrl: progressData.thumbnailUrl }),
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
  
  console.log(`🔍 Batch progress check for: ${batchId}`);
  
  // Collect all files for this batch
  const fileProgress = [];
  let totalProgress = 0;
  let fileCount = 0;
  let completedFiles = 0;
  let activeFiles = 0;
  
  // Find all uploads for this batch
  for (const [uploadId, data] of uploadProgressStore.entries()) {
    if (data.batchId === batchId) {
      const isActive = activeUploadTasks.has(uploadId);
      if (isActive) activeFiles++;
      
      fileProgress.push({
        uploadId: uploadId,
        progress: data.progress || 0,
        status: data.status,
        fileName: data.fileName,
        fileIndex: data.fileIndex,
        isActive: isActive,
        ...(data.fileUrl && { fileUrl: data.fileUrl })
      });
      
      totalProgress += data.progress || 0;
      fileCount++;
      if (data.progress >= 100) completedFiles++;
    }
  }
  
  console.log(`📊 Batch ${batchId}: ${fileCount} files, ${completedFiles} completed, ${activeFiles} active`);
  
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
    activeFiles: activeFiles,
    fileProgress: fileProgress
  });
});

// ✅ CLEAN UP PROGRESS DATA
router.delete('/progress/:uploadId', (req, res) => {
  const { uploadId } = req.params;
  
  console.log(`🗑️ Manual cleanup request for: ${uploadId}`);
  
  // Also check if there's an active task to cancel
  const uploadTask = activeUploadTasks.get(uploadId);
  if (uploadTask) {
    console.log(`🛑 Found active task, cancelling: ${uploadId}`);
    try {
      uploadTask.cancel();
    } catch (error) {
      console.error(`Error cancelling during cleanup: ${error.message}`);
    }
    activeUploadTasks.delete(uploadId);
  }
  
  if (uploadProgressStore.delete(uploadId)) {
    console.log(`✅ Cleanup successful: ${uploadId}`);
    res.json({ success: true, message: 'Progress data cleared' });
  } else {
    console.log(`❌ Cleanup failed - not found: ${uploadId}`);
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
    
    console.log('📤 ========== BATCH UPLOAD START ==========');
    console.log(`📤 Batch ID: ${batchId}`);
    console.log(`📤 Files: ${files.length}`);
    
    if (files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded'
      });
    }
    
    // Store batch info
    uploadProgressStore.set(batchId, {
      progress: 0,
      status: 'starting',
      totalFiles: files.length,
      completedFiles: 0,
      timestamp: Date.now()
    });

    const uploadResults = [];
    
    // Upload files sequentially
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileUploadId = `${batchId}_${i}`; // ✅ Match frontend format
      
      console.log(`📤 [${i + 1}/${files.length}] Starting: ${file.originalname} (${fileUploadId})`);
      
      try {
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
          
          // 🔴 Save upload task for cancellation
          console.log(`📤 Saving batch upload task: ${fileUploadId}`);
          activeUploadTasks.set(fileUploadId, uploadTask);

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
            (error) => {
              console.error(`❌ Batch upload failed for ${fileUploadId}:`, error.message);
              activeUploadTasks.delete(fileUploadId);
              reject(error);
            },
            async () => {
              try {
                const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                const fileType = getFileType(file.mimetype, file.originalname);
                let thumbnailUrl = null;
                
                if (fileType === 'image') {
                  thumbnailUrl = await generateThumbnail(file.buffer, file.originalname);
                }
                
                // 🔴 Remove from active tasks
                activeUploadTasks.delete(fileUploadId);
                
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
                
                // Update batch progress
                const completed = uploadResults.filter(r => r.url).length;
                uploadProgressStore.set(batchId, {
                  progress: Math.round((completed / files.length) * 100),
                  status: 'uploading',
                  totalFiles: files.length,
                  completedFiles: completed,
                  timestamp: Date.now()
                });
                
                console.log(`✅ Batch file ${i + 1} complete: ${file.originalname}`);
                resolve();
              } catch (error) {
                console.error(`❌ Post-processing failed for ${fileUploadId}:`, error);
                activeUploadTasks.delete(fileUploadId);
                reject(error);
              }
            }
          );
          
          // Handle cancellation for batch files
          uploadTask.then().catch((error) => {
            if (error.code === 'storage/canceled') {
              console.log(`🛑 Batch upload cancelled: ${fileUploadId}`);
              activeUploadTasks.delete(fileUploadId);
              uploadProgressStore.delete(fileUploadId);
            }
          });
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
      
      // Small delay between files
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    // Mark batch as complete
    const successfulUploads = uploadResults.filter(r => r.url);
    
    uploadProgressStore.set(batchId, {
      progress: 100,
      status: 'complete',
      totalFiles: files.length,
      completedFiles: successfulUploads.length,
      timestamp: Date.now()
    });
    
    console.log(`✅ Batch upload completed: ${successfulUploads.length}/${files.length} files`);
    console.log(`📤 Active tasks after batch: ${activeUploadTasks.size}`);
    console.log('📤 ========== BATCH UPLOAD END ==========\n');
    
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
      activeTasks: activeUploadTasks.size,
      progressEntries: uploadProgressStore.size,
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