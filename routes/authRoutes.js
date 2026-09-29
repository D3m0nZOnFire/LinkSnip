const express = require('express');
const router = express.Router();
const AuthController = require('../controllers/authController');
const configService = require('../services/configService');
const { authLimiter } = require('../middleware/rateLimiter');

// When registration is closed, /register doesn't exist (admins create accounts in Admin → Users)
const registrationOpen = (req, res, next) => (configService.get('registration.open') ? next() : next('route'));
router.get('/register', registrationOpen, AuthController.getRegister);
router.post('/register', registrationOpen, authLimiter, AuthController.postRegister);
router.get('/login', AuthController.getLogin);
router.post('/login', authLimiter, AuthController.postLogin);
router.get('/logout', AuthController.logout);

module.exports = router;