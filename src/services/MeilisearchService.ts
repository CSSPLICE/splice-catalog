import { MeiliSearch, Index } from 'meilisearch';
import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';

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

  async deleteItem(id: number) {
    await this.index.deleteDocument(id);
  }

  async search(query: string) {
    try {
      const searchResults = await this.index.search(query, {
        limit: 1000,
      });
      return searchResults.hits;
    } catch (error) {
      console.error('Meilisearch: Error performing search:', error);
      throw error;
    }
  }

  async setupSettings() {
    await this.index.updateSettings({
      searchableAttributes: ['title', 'keywords', 'description', 'author'],
      rankingRules: [
        'words',
        'typo',
        'proximity',
        'attribute',
        'exactness',
      ],
      typoTolerance: {
        minWordSizeForTypos: {
          oneTypo: 4,
        },
      },
    });
  }

  private normalizeAlias(term: string): string {
    return term.trim().toLowerCase();
  }

  private addSymmetricAlias(map: Record<string, string[]>, leftRaw: string, rightRaw: string) {
    const left = this.normalizeAlias(leftRaw);
    const right = this.normalizeAlias(rightRaw);
    if (!left || !right || left === right) return;

    if (!map[left]) map[left] = [];
    if (!map[right]) map[right] = [];

    if (!map[left].includes(right)) map[left].push(right);
    if (!map[right].includes(left)) map[right].push(left);
  }

  private resolveAliasesPath(): string {
    const configured = process.env.MEILI_SYNONYMS_FILE;
    if (configured) {
      return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
    }
    return path.resolve(process.cwd(), 'src/scripts/search/synonyms.txt');
  }

  private async loadSynonymsFromFile(): Promise<Record<string, string[]>> {
    const sourcePath = this.resolveAliasesPath();
    const fallbackDistPath = path.resolve(process.cwd(), 'dist/scripts/search/synonyms.txt');

    let synonymsPath = sourcePath;
    try {
      await fs.access(sourcePath);
    } catch {
      synonymsPath = fallbackDistPath;
    }

    try {
      await fs.access(synonymsPath);
    } catch {
      throw new Error(
        `Synonyms file not found. Checked: ${sourcePath} and ${fallbackDistPath}. ` +
          'Set MEILI_SYNONYMS_FILE to override.',
      );
    }

    const raw = await fs.readFile(synonymsPath, 'utf8');
    const map: Record<string, string[]> = {};
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));

    for (const line of lines) {
      if (line.includes('<->')) {
        const [left, right] = line.split('<->').map((part) => part.trim());
        this.addSymmetricAlias(map, left, right);
        continue;
      }

      if (line.includes('=>')) {
        const [left, rightList] = line.split('=>').map((part) => part.trim());
        const rights = rightList
          .split(',')
          .map((term) => term.trim())
          .filter(Boolean);
        for (const right of rights) {
          this.addSymmetricAlias(map, left, right);
        }
        continue;
      }

      const group = line
        .split(',')
        .map((term) => term.trim())
        .filter(Boolean);
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          this.addSymmetricAlias(map, group[i], group[j]);
        }
      }
    }

    return map;
  }

  async syncSynonyms() {
    try {
      const synonymMap = await this.loadSynonymsFromFile();

      console.log('Uploading synonyms to Meilisearch...');
      await this.index.updateSettings({
        synonyms: synonymMap,
      });

      console.log(`Synonym sync complete. ${Object.keys(synonymMap).length} terms configured.`);
    } catch (error) {
      console.error('Failed to sync synonyms:', error);
    }
  }
}

export const meilisearchService = new MeilisearchService();
