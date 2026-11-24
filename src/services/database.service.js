import mongoose from 'mongoose';
import { env } from '../config/env.js';

let connectionPromise = null;

mongoose.connection.on('disconnected', () => {
  console.error('[database] MongoDB disconnected; customer operations are unavailable.');
});

mongoose.connection.on('error', () => {
  console.error('[database] MongoDB connection error.');
});

export async function connectToDatabase(uri = env.mongodbUri) {
  if (!uri) {
    throw new Error('MONGODB_URI is not configured; the application cannot start.');
  }
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (connectionPromise) return connectionPromise;

  connectionPromise = mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 })
    .then(() => mongoose.connection)
    .catch((cause) => {
      connectionPromise = null;
      throw new Error(
        'MongoDB connection failed. Verify MONGODB_URI and database availability.',
        { cause },
      );
    });

  return connectionPromise;
}

export async function disconnectFromDatabase() {
  connectionPromise = null;
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
