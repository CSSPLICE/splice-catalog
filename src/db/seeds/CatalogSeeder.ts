import { AppDataSource } from '../data-source.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const runSeeder = async () => {
  try {
    console.log('🌱 Starting decoupled database seeding...');
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
      console.log('📡 Database connection established.');
    }

    const dataPath = path.join(__dirname, '../seed_data/item.json');
    const rawData = fs.readFileSync(dataPath, 'utf8');
    const items = JSON.parse(rawData);
    const itemArray = Array.isArray(items) ? items : [items];

    const queryRunner = AppDataSource.createQueryRunner();

    for (const item of itemArray) {
      const dataToInsert: any = {};
      for (const [key, value] of Object.entries(item)) {
        dataToInsert[key] = Array.isArray(value) ? value.join(', ') : value;
      }

      const columns = Object.keys(dataToInsert)
        .map((c) => `\`${c}\``)
        .join(', ');
      const values = Object.values(dataToInsert);
      const placeholders = values.map(() => '?').join(', ');

      await queryRunner.query(`INSERT IGNORE INTO \`slc_item_catalog\` (${columns}) VALUES (${placeholders})`, values);
    }

    console.log(`Successfully seeded ${itemArray.length} items!`);
  } catch (error) {
    console.error('Seeding failed:', error);
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
      console.log('Database connection closed.');
    }
  }
};

runSeeder();
