import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

export async function connectDb() {
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const configured = String(process.env.MONGODB_URI || '').trim();
  const useMemory = String(process.env.USE_MEMORY_MONGO || '').trim() === '1';
  const connectWith = async (uri) => {
    await mongoose.connect(uri, {
      autoIndex: !isProd,
      serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS) || 10_000,
      connectTimeoutMS: Number(process.env.MONGO_CONNECT_TIMEOUT_MS) || 10_000
    });
    return mongoose.connection;
  };

  if (useMemory) {
    const memory = await MongoMemoryServer.create({ instance: { dbName: 'webar' } });
    mongoose.connection.on('disconnected', async () => {
      try {
        await memory.stop();
      } catch (e) {}
    });
    return await connectWith(memory.getUri());
  }

  const primaryUri = configured || 'mongodb://127.0.0.1:27017/webar';
  try {
    return await connectWith(primaryUri);
  } catch (e) {
    if (isProd) throw e;
    const memory = await MongoMemoryServer.create({ instance: { dbName: 'webar' } });
    mongoose.connection.on('disconnected', async () => {
      try {
        await memory.stop();
      } catch (e2) {}
    });
    return await connectWith(memory.getUri());
  }
}
