import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../db/data-source.js';
import { HistoricalUsage } from '../db/entities/HistoricalUsage.js';

const PRODUCTION_API_URL = 'https://splice.cs.vt.edu/api/items';
const EXPECTED_SOURCE = 'nginx_historical';
const EXPECTED_CATALOG_TYPE = 'SLC_ITEM';
const MAX_UNSIGNED_INT = 4_294_967_295;

interface ProductionItem {
  id: number;
  persistentID: string;
  title: string;
  platform_name: string;
}

interface ImportItem {
  catalogType: string;
  legacyId: number;
  persistentID: string;
  title: string;
  catalogPath: string;
  viewCount: number;
}

interface ImportFile {
  version: number;
  generatedAt: string;
  source: string;
  filterPolicy: { description: string; knownBotIndicators: string[]; highVolumeClient: { minimumUniqueCatalogEntries: number; identity: string; order: string; excludeAllRequests: boolean } };
  summary: {
    successfulCatalogRequests: number;
    filteredBotRequests: number;
    postBotRequests: number;
    filteredHighVolumeClients: number;
    filteredHighVolumeRequests: number;
    includedRequests: number;
    uniqueIncludedItems: number;
    totalIncludedViews: number;
    productionApiItemCount: number;
  };
  items: ImportItem[];
}

interface ExistingHistoricalRow {
  catalogType: string;
  legacyCatalogId: number;
  itemPersistentID: string | null;
  itemTitle: string | null;
  catalogPath: string | null;
  viewCount: number;
  source: string;
}

type ValidatedRow = ExistingHistoricalRow;

function isPositiveUnsignedInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= MAX_UNSIGNED_INT;
}

export async function loadImportFile(path: string): Promise<ImportFile> {
  let contents: string;
  try {
    contents = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`Import file not found: ${path}`);
    throw new Error(`Could not read import file ${path}: ${String(error)}`);
  }

  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error('Import file is not valid JSON');
  }
  if (typeof value !== 'object' || value === null) throw new Error('Import file must contain a JSON object');

  const data = value as Record<string, unknown>;
  if (data.version !== 1) throw new Error('Unsupported import file version; expected version 1');
  if (typeof data.generatedAt !== 'string' || Number.isNaN(Date.parse(data.generatedAt))) {
    throw new Error('Import file generatedAt must be a valid timestamp');
  }
  if (data.source !== EXPECTED_SOURCE) throw new Error(`Import source must be ${EXPECTED_SOURCE}`);
  if (
    typeof data.filterPolicy !== 'object'
    || data.filterPolicy === null
    || typeof (data.filterPolicy as Record<string, unknown>).description !== 'string'
    || !Array.isArray((data.filterPolicy as Record<string, unknown>).knownBotIndicators)
    || !(data.filterPolicy as { knownBotIndicators: unknown[] }).knownBotIndicators.every((indicator) => typeof indicator === 'string')
  ) {
    throw new Error('Import file filterPolicy is missing a description or knownBotIndicators list');
  }
  const volumePolicy = (data.filterPolicy as Record<string, unknown>).highVolumeClient as Record<string, unknown> | undefined;
  if (!volumePolicy || volumePolicy.minimumUniqueCatalogEntries !== 63 || volumePolicy.identity !== 'IP address + User-Agent'
    || volumePolicy.order !== 'after known-bot filtering' || volumePolicy.excludeAllRequests !== true) {
    throw new Error('Import must declare the approved 63-distinct-entry cutoff per IP address + User-Agent after known-bot filtering');
  }
  if (typeof data.summary !== 'object' || data.summary === null) throw new Error('Import file summary must be an object');
  const summary = data.summary as Record<string, unknown>;
  const summaryFields = [
    'successfulCatalogRequests', 'filteredBotRequests', 'postBotRequests', 'filteredHighVolumeClients', 'filteredHighVolumeRequests', 'includedRequests',
    'uniqueIncludedItems', 'totalIncludedViews', 'productionApiItemCount',
  ];
  for (const field of summaryFields) {
    if (!Number.isSafeInteger(summary[field]) || Number(summary[field]) < 0) {
      throw new Error(`Import summary ${field} must be a non-negative integer`);
    }
  }
  if (!Array.isArray(data.items)) throw new Error('Import file items must be an array');

  const items: ImportItem[] = [];
  const seenIds = new Set<number>();
  const seenPersistentIds = new Set<string>();
  let totalViews = 0;
  for (const [index, rawItem] of data.items.entries()) {
    if (typeof rawItem !== 'object' || rawItem === null) throw new Error(`Import item ${index} must be an object`);
    const item = rawItem as Record<string, unknown>;
    if (item.catalogType !== EXPECTED_CATALOG_TYPE) throw new Error(`Import item ${index} catalogType must be ${EXPECTED_CATALOG_TYPE}`);
    if (!isPositiveUnsignedInteger(item.legacyId)) throw new Error(`Import item ${index} has an invalid legacyId`);
    if (!isPositiveUnsignedInteger(item.viewCount)) throw new Error(`Import item ${index} has an invalid viewCount`);
    if (typeof item.persistentID !== 'string' || item.persistentID.length === 0 || item.persistentID.length > 255) {
      throw new Error(`Import item ${index} has an invalid persistentID`);
    }
    if (typeof item.title !== 'string' || item.title.length === 0) throw new Error(`Import item ${index} has an invalid title`);
    if (typeof item.catalogPath !== 'string' || item.catalogPath !== `/catalog/item/${item.legacyId}`) {
      throw new Error(`Import item ${index} catalogPath cannot be reconstructed from legacyId ${item.legacyId}`);
    }
    if (seenIds.has(item.legacyId)) throw new Error(`Import file contains duplicate legacyId ${item.legacyId}`);
    if (seenPersistentIds.has(item.persistentID)) throw new Error(`Import file contains a duplicate persistentID at item ${index}`);
    seenPersistentIds.add(item.persistentID);
    seenIds.add(item.legacyId);
    totalViews += item.viewCount;
    if (!Number.isSafeInteger(totalViews)) throw new Error('Import file total viewCount exceeds the safe integer range');
    items.push({
      catalogType: EXPECTED_CATALOG_TYPE,
      legacyId: item.legacyId,
      persistentID: item.persistentID,
      title: item.title,
      catalogPath: item.catalogPath,
      viewCount: item.viewCount,
    });
  }

  if (items.length === 0) throw new Error('Import must contain at least one historical item');
  if (Number(summary.uniqueIncludedItems) !== items.length) throw new Error('Import summary uniqueIncludedItems does not match items.length');
  if (Number(summary.includedRequests) !== totalViews || Number(summary.totalIncludedViews) !== totalViews) {
    throw new Error('Import summary included request/view totals do not match the item view counts');
  }
  if (Number(summary.successfulCatalogRequests) - Number(summary.filteredBotRequests) !== Number(summary.postBotRequests)
    || Number(summary.postBotRequests) - Number(summary.filteredHighVolumeRequests) !== totalViews
    || Number(summary.filteredHighVolumeClients) > Number(summary.filteredHighVolumeRequests)) {
    throw new Error('Import summary filtering totals do not reconcile with included requests');
  }

  return {
    version: 1,
    generatedAt: data.generatedAt,
    source: EXPECTED_SOURCE,
    filterPolicy: data.filterPolicy as ImportFile['filterPolicy'],
    summary: summary as ImportFile['summary'],
    items,
  };
}

async function fetchProductionCatalog(): Promise<Map<number, ProductionItem>> {
  let response: Response;
  try {
    response = await fetch(PRODUCTION_API_URL, { signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    throw new Error(`Could not fetch production catalog from ${PRODUCTION_API_URL}: ${String(error)}`);
  }
  if (!response.ok) throw new Error(`Production catalog API returned HTTP ${response.status}`);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('Production catalog API did not return valid JSON');
  }
  const items = Array.isArray(body)
    ? body
    : typeof body === 'object' && body !== null && 'results' in body
      ? (body as { results: unknown }).results
      : undefined;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Production catalog API returned an unexpected payload; expected a non-empty array or an object with a results array');
  }

  const catalog = new Map<number, ProductionItem>();
  for (const [index, rawItem] of items.entries()) {
    if (typeof rawItem !== 'object' || rawItem === null) throw new Error(`Production API item ${index} is not an object`);
    const item = rawItem as Record<string, unknown>;
    const id = typeof item.id === 'number' ? item.id : Number(item.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Production API item ${index} has an invalid id`);
    if (typeof item.persistentID !== 'string' || typeof item.title !== 'string' || typeof item.platform_name !== 'string') {
      throw new Error(`Production API item ${index} is missing identity or title metadata`);
    }
    if (catalog.has(id)) throw new Error(`Production API returned duplicate numeric ID ${id}`);
    catalog.set(id, { id, persistentID: item.persistentID, title: item.title, platform_name: item.platform_name });
  }
  return catalog;
}

export function validateAgainstProduction(importFile: ImportFile, productionCatalog: Map<number, ProductionItem>) {
  const rows: ValidatedRow[] = [];
  const missingIds: number[] = [];
  const identityMismatches: Array<{ legacyId: number; importPersistentID: string; productionPersistentID: string }> = [];
  const titleChanges: number[] = [];

  for (const item of importFile.items) {
    const productionItem = productionCatalog.get(item.legacyId);
    if (!productionItem) {
      missingIds.push(item.legacyId);
      continue;
    }
    if (item.persistentID !== productionItem.persistentID) {
      identityMismatches.push({
        legacyId: item.legacyId,
        importPersistentID: item.persistentID,
        productionPersistentID: productionItem.persistentID,
      });
      continue;
    }
    if (item.title !== productionItem.title) titleChanges.push(item.legacyId);

    const catalogPath = `/catalog/item/${productionItem.id}`;
    if (item.catalogPath !== catalogPath) {
      throw new Error(`Import item ${item.legacyId} catalogPath does not match the production route ${catalogPath}`);
    }
    if (productionItem.persistentID.length > 255 || productionItem.title.length > 255) {
      throw new Error(`Production metadata for ID ${item.legacyId} exceeds the historical_usage column length`);
    }

    rows.push({
      catalogType: EXPECTED_CATALOG_TYPE,
      legacyCatalogId: productionItem.id,
      itemPersistentID: productionItem.persistentID,
      itemTitle: productionItem.title,
      catalogPath,
      viewCount: item.viewCount,
      source: importFile.source,
    });
  }

  return { rows, missingIds, identityMismatches, titleChanges };
}

export function compareWithExisting(rows: ValidatedRow[], existing: ExistingHistoricalRow[]) {
  const existingById = new Map(existing.map((row) => [row.legacyCatalogId, row]));
  let rowsWouldInsert = 0;
  let rowsWouldUpdate = 0;
  let unchangedRows = 0;
  for (const row of rows) {
    const current = existingById.get(row.legacyCatalogId);
    if (!current) {
      rowsWouldInsert += 1;
    } else if (
      current.viewCount !== row.viewCount
      || current.itemPersistentID !== row.itemPersistentID
      || current.itemTitle !== row.itemTitle
      || current.catalogPath !== row.catalogPath
    ) {
      rowsWouldUpdate += 1;
    } else {
      unchangedRows += 1;
    }
  }

  const importIds = new Set(rows.map((row) => row.legacyCatalogId));
  const priorTotal = existing.reduce((sum, row) => sum + row.viewCount, 0);
  const replacedTotal = existing.reduce((sum, row) => sum + (importIds.has(row.legacyCatalogId) ? row.viewCount : 0), 0);
  const importTotal = rows.reduce((sum, row) => sum + row.viewCount, 0);
  return {
    rowsWouldInsert,
    rowsWouldUpdate,
    unchangedRows,
    extraExistingRows: existing.filter((row) => !importIds.has(row.legacyCatalogId)).length,
    existingIdentityMismatches: rows.filter((row) => existingById.has(row.legacyCatalogId) && existingById.get(row.legacyCatalogId)!.itemPersistentID !== row.itemPersistentID).length,
    totalHistoricalViewsAfterImport: priorTotal - replacedTotal + importTotal,
  };
}

function printSummary(
  importFile: ImportFile,
  productionCatalog: Map<number, ProductionItem>,
  validation: ReturnType<typeof validateAgainstProduction>,
  comparison: ReturnType<typeof compareWithExisting>,
  dryRun: boolean,
): void {
  console.log(dryRun ? 'Historical usage seed preview (dry run)' : 'Historical usage seed');
  console.log(`Source: ${importFile.source}`);
  console.log(`Import file item count: ${importFile.items.length}`);
  console.log(`Import file total views: ${importFile.summary.totalIncludedViews}`);
  console.log(`Production API item count: ${productionCatalog.size}`);
  console.log(`Matched IDs: ${validation.rows.length}`);
  console.log(`Missing IDs: ${validation.missingIds.length}${validation.missingIds.length ? ` (${validation.missingIds.slice(0, 10).join(', ')})` : ''}`);
  console.log(`PersistentID mismatches: ${validation.identityMismatches.length}${validation.identityMismatches.length ? ` (${validation.identityMismatches.slice(0, 10).map(({ legacyId }) => legacyId).join(', ')})` : ''}`);
  console.log(`Title metadata changed since analysis: ${validation.titleChanges.length}`);
  console.log(`Rows that would insert: ${comparison.rowsWouldInsert}`);
  console.log(`Rows that would update: ${comparison.rowsWouldUpdate}`);
  console.log(`Unchanged rows: ${comparison.unchangedRows}`);
  console.log(`Existing rows absent from import: ${comparison.extraExistingRows}`);
  console.log(`Existing-row identity mismatches: ${comparison.existingIdentityMismatches}`);
  console.log(`Total historical views after import: ${comparison.totalHistoricalViewsAfterImport}`);
  console.log(`Validation status: ${validation.missingIds.length || validation.identityMismatches.length || comparison.extraExistingRows || comparison.existingIdentityMismatches ? 'FAIL' : 'PASS'}`);
}

export interface SeedOptions {
  filePath: string;
  dryRun: boolean;
  confirmTarget?: string;
  approveProduction: boolean;
}

export function parseSeedOptions(args: string[]): SeedOptions {
  const options: SeedOptions = { filePath: '', dryRun: false, approveProduction: false };
  for (const argument of args) {
    if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--approve-production') options.approveProduction = true;
    else if (argument.startsWith('--confirm-target=')) options.confirmTarget = argument.slice('--confirm-target='.length);
    else if (argument.startsWith('--')) throw new Error(`Unsupported option: ${argument}`);
    else if (options.filePath) throw new Error('Exactly one import file is required');
    else options.filePath = argument;
  }
  if (!options.filePath) throw new Error('Usage: usage:seed-history <import.json> [--dry-run] [--confirm-target=HOST:PORT/DATABASE] [--approve-production]');
  return options;
}

export function assertSeedTarget(
  target: { host?: string; port?: number; database?: string; replication?: unknown; synchronize?: boolean; migrationsRun?: boolean },
  options: SeedOptions,
  environment: string | undefined,
): string {
  if (!target.host || !target.database || target.replication) throw new Error('A single explicit MySQL host and database are required');
  if (target.synchronize || target.migrationsRun) throw new Error('Historical imports must not synchronize schema or execute migrations');
  const name = `${target.host}:${target.port ?? 3306}/${target.database}`;
  if (options.confirmTarget !== undefined && options.confirmTarget !== name) throw new Error('Confirmed target does not match the configured database');
  if (!options.dryRun) {
    if (options.confirmTarget !== name) throw new Error(`Writes require --confirm-target=${name} after reviewing a dry run`);
    if (environment !== 'development' && environment !== 'production') throw new Error('Set NODE_ENV explicitly to development or production');
    const localHost = ['db', 'localhost', '127.0.0.1', '::1'].includes(target.host);
    if ((environment === 'production' || !localHost) && !options.approveProduction) {
      throw new Error('Production or non-local writes require explicit approval and --approve-production');
    }
  }
  return name;
}

function assertExistingRowsSafe(comparison: ReturnType<typeof compareWithExisting>): void {
  if (comparison.extraExistingRows || comparison.existingIdentityMismatches) {
    throw new Error('Existing historical rows are incompatible with this import; no writes. Back up the scoped dataset and arrange a separately approved transactional replacement; an upsert cannot remove stale rows');
  }
}

// Exposed for isolated transaction tests; CLI uses the configured MySQL target.
export async function seedHistoricalUsage(
  importFile: ImportFile,
  productionCatalog: Map<number, ProductionItem>,
  dryRun: boolean,
  dataSource: DataSource = AppDataSource,
): Promise<void> {
  const validation = validateAgainstProduction(importFile, productionCatalog);
  if (validation.missingIds.length || validation.identityMismatches.length) {
    printSummary(importFile, productionCatalog, validation, compareWithExisting(validation.rows, []), dryRun);
    throw new Error('Production identity validation failed before database initialization; no writes');
  }
  if (dataSource.options.synchronize || dataSource.options.migrationsRun) throw new Error('Automatic schema changes are not permitted');
  await dataSource.initialize();
  let queryRunner: ReturnType<DataSource['createQueryRunner']> | undefined;
  try {
    if (dryRun) {
      const existing = await dataSource.getRepository(HistoricalUsage).find({
        where: { source: importFile.source, catalogType: EXPECTED_CATALOG_TYPE },
      });
      const comparison = compareWithExisting(validation.rows, existing);
      printSummary(importFile, productionCatalog, validation, comparison, true);
      assertExistingRowsSafe(comparison);
      console.log('Dry run complete; no historical records were written.');
      return;
    }
    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    const repository = queryRunner.manager.getRepository(HistoricalUsage);
    const existing = await repository.find({
      where: { source: importFile.source, catalogType: EXPECTED_CATALOG_TYPE },
    });
    const comparison = compareWithExisting(validation.rows, existing);
    printSummary(importFile, productionCatalog, validation, comparison, false);
    assertExistingRowsSafe(comparison);
    if (comparison.rowsWouldInsert || comparison.rowsWouldUpdate) {
      await repository.upsert(validation.rows, ['source', 'catalogType', 'legacyCatalogId']);
    }
    await queryRunner.commitTransaction();
    console.log('Historical usage import complete. Aggregate rows were upserted transactionally.');
  } catch (error) {
    if (queryRunner?.isTransactionActive) await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    if (queryRunner && queryRunner.isReleased === false) await queryRunner.release();
    await dataSource.destroy();
  }
}

async function main(): Promise<void> {
  const options = parseSeedOptions(process.argv.slice(2));
  if (AppDataSource.options.type !== 'mysql') throw new Error('Historical imports require MySQL');
  const target = assertSeedTarget(AppDataSource.options, options, process.env.NODE_ENV);
  console.log(`Target: ${target}; NODE_ENV=${process.env.NODE_ENV ?? 'unset'}; mode=${options.dryRun ? 'dry-run' : 'write'}`);
  // Avoid SQL parameter logging, including for local previews.
  const dataSource = new DataSource({ ...AppDataSource.options, logging: false });
  const importFile = await loadImportFile(resolve(options.filePath));
  const productionCatalog = await fetchProductionCatalog();
  await seedHistoricalUsage(importFile, productionCatalog, options.dryRun, dataSource);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(`Historical usage import failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
