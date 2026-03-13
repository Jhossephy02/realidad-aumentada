import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

export async function connectDb() {
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const configured = String(process.env.MONGODB_URI || '').trim();
  const useMemory = String(process.env.USE_MEMORY_MONGO || '').trim() === '1';
  let uri = configured;
  if (!uri && useMemory) {
    const memory = await MongoMemoryServer.create({ instance: { dbName: 'webar' } });
    uri = memory.getUri();
    mongoose.connection.on('disconnected', async () => {
      try {
        await memory.stop();
      } catch (e) {}
    });
  }
  if (!uri) uri = 'mongodb://127.0.0.1:27017/webar';
  await mongoose.connect(uri, {
    autoIndex: !isProd,
    serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS) || 10_000,
    connectTimeoutMS: Number(process.env.MONGO_CONNECT_TIMEOUT_MS) || 10_000
  });
  return mongoose.connection;
}
