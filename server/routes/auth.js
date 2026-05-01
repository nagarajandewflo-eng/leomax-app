const express = require('express');
const router = express.Router();
const { authenticateToken, authorizeRoles } = require("../middleware/auth");
const { register, login, refresh, changePassword, sendOTP, resendOTP, verifyOTP , getUsers, deleteUser} = require('../controllers/authController');

router.post('/register',authenticateToken, authorizeRoles('admin'), register);
router.post('/login', login);
router.post('/refresh', refresh);
router.post('/change-password', changePassword);
router.post('/send-otp', sendOTP);
router.post('/resend-otp', resendOTP);
router.post('/verify-otp', verifyOTP);
router.get('/users', authenticateToken, authorizeRoles('admin'), getUsers);
router.delete('/users/:id',authenticateToken, authorizeRoles('admin'), deleteUser);

module.exports = router;
