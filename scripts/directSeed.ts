import mysql from 'mysql2/promise';
import fs from 'fs/promises';
import path from 'path';
import 'dotenv/config';
import { meilisearchService } from '../src/services/MeilisearchService.js';

export const seedDatabase = async () => {
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

    const dataPath = path.join(process.cwd(), 'data/slc.json');
    console.log(`Reading records from: ${dataPath}`);
    
    const rawData = await fs.readFile(dataPath, 'utf8');
    const items = JSON.parse(rawData);
    const itemsArray = Array.isArray(items) ? items : [items];

    console.log(`🧹 Clearing database and attempting to seed ${itemsArray.length} items...`);
    await connection.execute('DELETE FROM slc_item_catalog');

    for (const item of itemsArray) {
      const dataToInsert: any = {};
      const validColumns = [
        'catalog_type', 'platform_name', 'iframe_url', 'persistentID', 
        'license', 'description', 'title', 'institution', 'keywords', 
        'features', 'programming_language', 'natural_language', 
        'protocol', 'protocol_url', 'author'
      ];

      for (const col of validColumns) {
        const value = item[col];
        dataToInsert[col] = Array.isArray(value) ? value.join(', ') : (value || '');
      }

      const columns = Object.keys(dataToInsert).map(c => `\`${c}\``).join(', ');
      const values = Object.values(dataToInsert);
      const placeholders = values.map(() => '?').join(', ');

      // Use INSERT IGNORE to skip duplicates without crashing
      await connection.execute(
        `INSERT IGNORE INTO slc_item_catalog (${columns}) VALUES (${placeholders})`,
        values
      );
    }

    // Fetch only the successfully inserted rows
    const [rows]: any = await connection.execute('SELECT * FROM slc_item_catalog');
    console.log(`✅ MySQL seeded with ${rows.length} unique records. Syncing to Meilisearch...`);

    await meilisearchService.setupSettings();
    await meilisearchService.indexCatalogItems(rows);

    console.log(`🚀 SUCCESS! Search is now live with ${rows.length} items.`);

  } catch (error) {
    console.error('❌ Seeding Failed:', error);
  } finally {
    if (connection) await connection.end();
  }
};

seedDatabase();