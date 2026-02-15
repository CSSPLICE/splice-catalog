import mysql from 'mysql2/promise';
import { meilisearchService } from '../src/services/MeilisearchService.js';
import 'dotenv/config';

export const syncCatalogToMeili = async () => {
  let connection;
  try {
    console.log('Connecting directly to MySQL...');

    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'db',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USERNAME || 'splice',
      password: process.env.DB_PASSWORD || 'splice',
      database: process.env.DB_DATABASE || 'splice',
    });

    console.log('Fetching catalog items via raw SQL...');
    const [rows] = await connection.execute('SELECT * FROM slc_item_catalog');
    const allItems = rows as any[];

    if (!allItems || allItems.length === 0) {
      console.log('No items found in the slc_item_catalog table.');
      return;
    }

    console.log(`Syncing ${allItems.length} items to Meilisearch...`);

    await meilisearchService.setupSettings();

    const task = await meilisearchService.indexCatalogItems(allItems);

    console.log('Success! Initial Sync complete.');
    console.log(`Task ID: ${task.taskUid}`);
  } catch (error) {
    console.error('Sync Failed:', error);
  } finally {
    if (connection) await connection.end();
  }
};

syncCatalogToMeili();
