import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { login, createUser } from '../controllers/authController.js';
import { requireAuthIfEnabled } from '../middleware/auth.js';

export const authRoutes = Router();

authRoutes.post('/auth/login', asyncHandler(login));
authRoutes.post('/users', requireAuthIfEnabled, asyncHandler(createUser));
