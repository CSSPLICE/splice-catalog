import { MeiliSearch, Index } from 'meilisearch';
import 'dotenv/config';

export class MeilisearchService {
  private client: MeiliSearch;
  private index: Index;

  constructor() {
    this.client = new MeiliSearch({
      host: process.env.MEILISEARCH_HOST || 'http://meilisearch:7700',
      apiKey: process.env.MEILI_MASTER_KEY,
    });

    this.index = this.client.index('catalog');
  }

  async indexCatalogItems(items: any[]) {
    try {
      const task = await this.index.addDocuments(items, { primaryKey: 'id' });
      console.log(`Meilisearch: Indexing task submitted. Task ID: ${task.taskUid}`);
      return task;
    } catch (error) {
      console.error('Meilisearch: Error indexing documents:', error);
      throw error;
    }
  }

  async deleteDocument(id: string | number) {
    try {
      const task = await this.index.deleteDocument(id);
      console.log(`Meilisearch: Deletion task submitted for ID ${id}. Task ID: ${task.taskUid}`);
      return task;
    } catch (error) {
      console.error('Meilisearch: Error deleting document:', error);
      throw error;
    }
  }

  async search(query: string) {
    try {
      const searchResults = await this.index.search(query, {
        limit: 1000
      });
      return searchResults.hits; 
    } catch (error) {
      console.error('Meilisearch: Error performing search:', error);
      throw error;
    }
}

  async setupSettings() {
    await this.index.updateSettings({
      searchableAttributes: [
        'title',
        'keywords',
        'description',
        'author'
      ],
      rankingRules: [
       'words',      // Matches the most words first
       'typo',       // Favors fewer typos
       'proximity',  // Favors words that are close together (Critical for "Binary Search Tree")
       'attribute',  // Favors matches in the title over the description
       'exactness'   // Favors exact matches
      ],
      typoTolerance: {
        minWordSizeForTypos: {
          oneTypo: 4
        },
      },
    });
  }
}

export const meilisearchService = new MeilisearchService();