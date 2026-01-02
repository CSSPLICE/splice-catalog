import mysql from 'mysql2/promise';
import fs from 'fs/promises';
import path from 'path';
import 'dotenv/config';

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

    const dataPath = path.join(process.cwd(), 'src/db/seed_data/item.json');
    const rawData = await fs.readFile(dataPath, 'utf8');
    const parsedData = JSON.parse(rawData);

    const items = Array.isArray(parsedData) ? parsedData : [parsedData];

    console.log(`Processing ${items.length} item(s)...`);

    for (const item of items) {
      const dataToInsert: any = {};
      for (const [key, value] of Object.entries(item)) {
        if (Array.isArray(value)) {
          dataToInsert[key] = value.join(', '); 
        } else {
          dataToInsert[key] = value;
        }
      }

      dataToInsert['institution'] = dataToInsert['institution'] || 'Unknown';

      const columns = Object.keys(dataToInsert).map(c => `\`${c}\``).join(', ');
      const values = Object.values(dataToInsert);
      const placeholders = values.map(() => '?').join(', ');

      await connection.execute(
        `INSERT IGNORE INTO slc_item_catalog (${columns}) VALUES (${placeholders})`,
        values
      );
    }

    console.log('Success! Database seeded with the item.');
  } catch (error) {
    console.error('Seeding Failed:', error);
  } finally {
    if (connection) await connection.end();
  }
};

seedDatabase();