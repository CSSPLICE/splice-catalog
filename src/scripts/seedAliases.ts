import { meilisearchService } from '../services/MeilisearchService.js';
import 'dotenv/config';

export const seedAliases = async () => {
  try {
    console.log('Syncing Meilisearch synonyms from synonyms.txt...');
    await meilisearchService.syncSynonyms();
  } catch (error) {
    console.error('Seeding Failed:', error);
  }
};

seedAliases();
