import 'reflect-metadata';
import 'dotenv/config';
import { AppDataSource } from '../db/data-source.js';
import { slc_item_catalog } from '../db/entities/SLCItemCatalog.js';
import { meilisearchService } from '../services/MeilisearchService.js';

async function reindexMeiliFromDb() {
  await AppDataSource.initialize();

  try {
    const itemRepository = AppDataSource.getRepository(slc_item_catalog);
    const allItems = await itemRepository.find();

    console.log(`Found ${allItems.length} SLC items in MySQL.`);

    await meilisearchService.setupSettings();
    await meilisearchService.syncSynonyms();

    if (allItems.length === 0) {
      console.log('No SLC items found to index.');
      return;
    }

    await meilisearchService.indexCatalogItems(allItems);
    console.log(`Submitted ${allItems.length} SLC items to Meilisearch for indexing.`);
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

reindexMeiliFromDb().catch((error) => {
  console.error('Meilisearch reindex failed:', error);
  process.exit(1);
});
