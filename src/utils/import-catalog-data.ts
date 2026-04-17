import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { validate, ValidationError } from 'class-validator';
import { AppDataSource } from '../db/data-source.js';
import { slc_item_catalog } from '../db/entities/SLCItemCatalog.js';
import { slc_tools_catalog } from '../db/entities/SLCToolsCatalog.js';
import { dataset_catalog } from '../db/entities/DatasetCatalog.js';
import { meilisearchService } from '../services/MeilisearchService.js';

type CatalogRecord = Record<string, unknown> & {
  catalog_type?: string;
  persistentID?: string;
  title?: string;
};

const resolveInputPath = (inputArg?: string): string => {
  const requestedPath = inputArg || 'data/OpenDSASLC.json';
  return path.isAbsolute(requestedPath) ? requestedPath : path.resolve(process.cwd(), requestedPath);
};

const hasBlockingValidationErrors = (errors: ValidationError[]): boolean => {
  return errors.some((validationError) => {
    const constraints = validationError.constraints || {};
    const contexts = validationError.contexts || {};
    return Object.keys(constraints).some((constraintName) => contexts[constraintName]?.severity === 'error');
  });
};

async function importCatalogData() {
  const inputPath = resolveInputPath(process.argv[2]);

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Catalog data file not found: ${inputPath}`);
  }

  const rawFile = fs.readFileSync(inputPath, 'utf8');
  const payload = JSON.parse(rawFile);
  const records: CatalogRecord[] = Array.isArray(payload) ? payload : [payload];

  if (records.length === 0) {
    console.log('No records found in the provided file.');
    return;
  }

  await AppDataSource.initialize();

  try {
    const itemRepository = AppDataSource.getRepository(slc_item_catalog);
    const toolsRepository = AppDataSource.getRepository(slc_tools_catalog);
    const datasetRepository = AppDataSource.getRepository(dataset_catalog);

    const validSlcItems: slc_item_catalog[] = [];
    const validTools: slc_tools_catalog[] = [];
    const validDatasets: dataset_catalog[] = [];
    let skipped = 0;
    const seenSlcPersistentIds = new Set<string>();

    for (const record of records) {
      switch (record.catalog_type) {
        case 'SLCItem': {
          const persistentID = typeof record.persistentID === 'string' ? record.persistentID.trim() : '';
          if (!persistentID) {
            skipped += 1;
            console.warn(`Skipping SLCItem without persistentID: ${record.title || 'unknown id'}`);
            continue;
          }
          if (seenSlcPersistentIds.has(persistentID)) {
            skipped += 1;
            console.warn(`Skipping duplicate SLCItem in input: ${persistentID}`);
            continue;
          }

          const entity = itemRepository.create(record);
          const validationErrors = await validate(entity);
          if (hasBlockingValidationErrors(validationErrors)) {
            skipped += 1;
            console.warn(`Skipping invalid SLCItem: ${record.persistentID || record.title || 'unknown id'}`);
            continue;
          }
          seenSlcPersistentIds.add(persistentID);
          validSlcItems.push(entity);
          break;
        }
        case 'SLCToolsCatalog': {
          const entity = toolsRepository.create(record);
          const validationErrors = await validate(entity);
          if (hasBlockingValidationErrors(validationErrors)) {
            skipped += 1;
            console.warn(`Skipping invalid SLCToolsCatalog: ${record.title || 'unknown id'}`);
            continue;
          }
          validTools.push(entity);
          break;
        }
        case 'DatasetCatalog': {
          const entity = datasetRepository.create(record);
          const validationErrors = await validate(entity);
          if (hasBlockingValidationErrors(validationErrors)) {
            skipped += 1;
            console.warn(`Skipping invalid DatasetCatalog: ${record.title || 'unknown id'}`);
            continue;
          }
          validDatasets.push(entity);
          break;
        }
        default: {
          skipped += 1;
          console.warn(`Skipping unsupported catalog_type: ${String(record.catalog_type || 'missing')}`);
        }
      }
    }

    if (validSlcItems.length > 0) {
      const existingItems = await itemRepository.find({
        where: validSlcItems.map((item) => ({ persistentID: item.persistentID })),
        select: { persistentID: true },
      });
      const existingPersistentIds = new Set(existingItems.map((item) => item.persistentID));
      const newSlcItems = validSlcItems.filter((item) => !existingPersistentIds.has(item.persistentID));

      skipped += validSlcItems.length - newSlcItems.length;

      if (newSlcItems.length > 0) {
        await itemRepository.save(newSlcItems, { chunk: 100 });
        await meilisearchService.indexCatalogItems(newSlcItems);
      }
    }

    if (validTools.length > 0) {
      await toolsRepository.save(validTools, { chunk: 100 });
    }

    if (validDatasets.length > 0) {
      await datasetRepository.save(validDatasets, { chunk: 100 });
    }

    console.log(`Imported ${validSlcItems.length} SLC items, ${validTools.length} tools, and ${validDatasets.length} datasets.`);
    console.log(`Skipped ${skipped} records.`);
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

importCatalogData().catch((error) => {
  console.error('Catalog import failed:', error);
  process.exit(1);
});
