import crypto from 'crypto';

export function newArId() {
  return crypto.randomBytes(12).toString('hex');
}

