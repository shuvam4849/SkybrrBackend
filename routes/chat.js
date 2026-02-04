const express = require('express');
const router = express.Router();

// Import middleware
const { firebaseProtect } = require('../middleware/firebaseAuth');

// Import controllers
const {
  accessChat,
  fetchChats,
  createGroupChat,
  renameGroup,
  addToGroup,
  removeFromGroup,
  searchUsers,
  getChatMedia,
  deleteChat,
  checkExistingChat
} = require('../controllers/chatController');

// Apply Firebase authentication to ALL chat routes
router.use(firebaseProtect);

// Define routes
router.post('/', accessChat);
router.get('/', fetchChats);
router.post('/group', createGroupChat);
router.put('/group/rename', renameGroup);
router.put('/group/add', addToGroup);
router.put('/group/remove', removeFromGroup);
router.get('/search/:query', searchUsers);
router.get('/check/:userId', checkExistingChat); // This will be protected by firebaseProtect
router.delete('/:chatId', deleteChat);

module.exports = router;