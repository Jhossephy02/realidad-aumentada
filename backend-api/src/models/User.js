import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, required: true, default: 'admin' }
  },
  { timestamps: true }
);

userSchema.methods.verifyPassword = async function verifyPassword(password) {
  return await bcrypt.compare(String(password || ''), this.passwordHash);
};

userSchema.statics.hashPassword = async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(String(password || ''), salt);
};

export const User = mongoose.models.User || mongoose.model('User', userSchema);

