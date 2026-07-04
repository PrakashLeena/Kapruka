import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const uri = process.env.MONGODB_URI;
console.log('Using MONGODB_URI:', uri ? uri.replace(/:([^@]+)@/, ':****@') : 'undefined');

if (!uri) {
  console.error('Error: MONGODB_URI is not set in .env');
  process.exit(1);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

async function run() {
  try {
    console.log('Connecting to MongoDB...');
    await client.connect();
    console.log('Ping admin database...');
    await client.db('admin').command({ ping: 1 });
    console.log('✅ Connection Successful!');
  } catch (err) {
    console.error('❌ Connection Failed!');
    console.error(err);
  } finally {
    await client.close();
  }
}

run();
