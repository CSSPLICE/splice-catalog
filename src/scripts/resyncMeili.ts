import { AppDataSource } from '../db/data-source.js';
import { slc_item_catalog } from '../db/entities/SLCItemCatalog.js';
import { meilisearchService } from '../services/MeilisearchService.js';
import 'dotenv/config';

async function resync() {
  await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(slc_item_catalog);
  const records = await repo.find();
  console.log(`DB: Found ${records.length} records`);

  try {
    await meilisearchService.deleteIndex('catalog');
  } catch (e: any) {
    if (e.code !== 'index_not_found') throw e;
  }

  const BATCH_SIZE = 1000;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    await meilisearchService.indexCatalogItems(batch);
    console.log(`Indexed ${Math.min(i + BATCH_SIZE, records.length)}/${records.length}`);
  }

  await meilisearchService.setupSettings();
  await meilisearchService.syncSynonyms();

  await AppDataSource.destroy();
  console.log('Resync complete');
}

resync();
