import { MeiliSearch, Index } from 'meilisearch';

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
      const task = await this.index.addDocuments(items);
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

  async setupSettings() {
    await this.index.updateSettings({
      searchableAttributes: [
        'title',
        'description',
        'author',
        'tags'
      ],
      filterableAttributes: ['category', 'type'],
      sortableAttributes: ['createdAt']
    });
  }
}

export const meilisearchService = new MeilisearchService();