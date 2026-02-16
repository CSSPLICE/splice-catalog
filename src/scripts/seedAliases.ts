import mysql from 'mysql2/promise';
import { meilisearchService } from '../services/MeilisearchService.js';
import 'dotenv/config';

export const seedAliases = async () => {
  let connection;
  try {
    console.log('Connecting to MySQL...');
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'db',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USERNAME || 'splice',
      password: process.env.DB_PASSWORD || 'splice',
      database: process.env.DB_DATABASE || 'splice',
    });

  await meilisearchService.syncSynonyms(connection);
  } catch (error) {
    console.error('Seeding Failed:', error);
  } finally {
    if (connection) await connection.end();
  }
}

seedAliases();
