import 'reflect-metadata';
import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
import AdminJS, { ApiController, Filter, ValidationError, ViewHelpers } from 'adminjs';
import { Resource } from '@adminjs/typeorm';
import { matchRoutes } from 'react-router';
import { AppDataSource } from '../src/db/data-source.ts';
import { slc_item_catalog } from '../src/db/entities/SLCItemCatalog.ts';
import { ItemClassification } from '../src/db/entities/ItemClassification.ts';
import { OntologyClasses } from '../src/db/entities/OntologyClass.ts';
import { SlcItemAdminResource } from '../src/admin-panel/SlcItemAdminResource.ts';
import { ItemClassificationAdminResource } from '../src/admin-panel/ItemClassificationAdminResource.ts';
import { meilisearchService } from '../src/services/MeilisearchService.ts';

// Real metadata, adapters and AdminJS controllers; all persistence and search I/O is in memory.
let items, classifications, removed, indexed, savedReferences, queries;
let itemResource, classificationResource, api, helpers;
const persistentID = (id) => `https://example.test/exercises/${id}/a%2Fb?x=1&y=two#fragment`;

function matches(row, where = {}) {
  return Object.entries(where).every(([key, expected]) => {
    const actual = key === 'item' ? row.item?.persistentID : row[key];
    if (expected?.type === 'in') return expected.value.some((value) => String(actual) === String(value));
    if (expected?.type === 'like') return String(actual).includes(expected.value.slice(1, -1));
    return String(actual) === String(key === 'item' ? (expected?.persistentID ?? expected) : expected);
  });
}

function itemInstance(row) {
  return row ? Object.assign(new slc_item_catalog(), row) : null;
}

function classificationInstance(row, includeItem = false) {
  if (!row) return null;
  const value = Object.assign(new ItemClassification(), row);
  // Match TypeORM: the ManyToOne entity is absent unless the relation was requested.
  if (includeItem) {
    const item = [...items.values()].find((entry) => entry.persistentID === row.item?.persistentID);
    value.item = itemInstance(item);
  } else {
    delete value.item;
  }
  return value;
}

function recordRequest(resource, id, action, method = 'get', payload = {}) {
  return { params: { resourceId: resource.id(), recordId: String(id), action }, query: {}, method, payload };
}

function resourceRequest(resource, action, query = {}, method = 'get', payload = {}) {
  return { params: { resourceId: resource.id(), action }, query, method, payload };
}

before(async () => {
  await AppDataSource.buildMetadatas(); // Metadata only: never initialize a database connection.
  AppDataSource.createQueryRunner = () => {
    throw new Error('Database access is forbidden in admin tests');
  };
  slc_item_catalog.findOneBy = async (where) => {
    queries.push({ model: 'items', where });
    return itemInstance([...items.values()].find((row) => matches(row, where)));
  };
  slc_item_catalog.findBy = async (where) => {
    queries.push({ model: 'items', where });
    return [...items.values()].filter((row) => matches(row, where)).map(itemInstance);
  };
  slc_item_catalog.find = async (options = {}) => {
    queries.push({ model: 'items', ...options });
    return [...items.values()]
      .filter((row) => matches(row, options.where))
      .slice(options.skip || 0, (options.skip || 0) + (options.take ?? items.size))
      .map(itemInstance);
  };
  slc_item_catalog.count = async (options) => [...items.values()].filter((row) => matches(row, options.where)).length;
  slc_item_catalog.prototype.save = async function () {
    items.set(this.id, { ...this });
    await this.syncToMeilisearch();
    return this;
  };
  slc_item_catalog.prototype.remove = async function () {
    removed.push({ id: this.id, persistentID: this.persistentID });
    items.delete(this.id);
    await this.removeFromMeilisearch();
    return this;
  };
  ItemClassification.findOneBy = async (where) =>
    classificationInstance([...classifications.values()].find((row) => matches(row, where)));
  ItemClassification.findBy = async (where) =>
    [...classifications.values()].filter((row) => matches(row, where)).map((row) => classificationInstance(row));
  ItemClassification.find = async (options = {}) => {
    queries.push({ model: 'classifications', ...options });
    return [...classifications.values()]
      .filter((row) => matches(row, options.where))
      .slice(options.skip || 0, (options.skip || 0) + (options.take ?? classifications.size))
      .map((row) => classificationInstance(row, Boolean(options.relations?.item)));
  };
  ItemClassification.count = async (options) =>
    [...classifications.values()].filter((row) => matches(row, options.where)).length;
  ItemClassification.prototype.save = async function () {
    this.id ??= Math.max(0, ...classifications.keys()) + 1;
    const previous = classifications.get(this.id);
    const item = this.item ?? previous?.item;
    assert.ok([...items.values()].some((entry) => entry.persistentID === item?.persistentID));
    assert.equal(item.id, undefined);
    savedReferences.push(item.persistentID);
    classifications.set(this.id, { ...previous, ...this, item: { ...item } });
    return this;
  };
  OntologyClasses.findBy = async () => [];
  meilisearchService.indexCatalogItems = async (rows) => {
    indexed.push(...rows.map((row) => ({ ...row })));
  };
  meilisearchService.deleteItem = async (id) => {
    indexed.push({ deletedId: id });
  };
});

beforeEach(() => {
  items = new Map(
    Array.from({ length: 105 }, (_, i) => {
      const id = i + 1;
      return [
        id,
        { id, persistentID: persistentID(id), title: `Exercise ${id}`, platform_name: id % 2 ? 'Alpha' : 'Beta' },
      ];
    }),
  );
  classifications = new Map([
    [1, { id: 1, item: { persistentID: persistentID(2) } }],
    [2, { id: 2, item: { persistentID: persistentID(42) } }],
  ]);
  removed = [];
  indexed = [];
  savedReferences = [];
  queries = [];
  itemResource = new SlcItemAdminResource(slc_item_catalog);
  classificationResource = new ItemClassificationAdminResource(ItemClassification, itemResource);
  const admin = new AdminJS({
    resources: [itemResource, classificationResource, new Resource(OntologyClasses)],
    rootPath: '/admin',
  });
  api = new ApiController({ admin }, { email: 'admin@example.test' });
  helpers = new ViewHelpers(admin);
});

test('SLC serialization and adapter properties use numeric identity without changing TypeORM metadata', async () => {
  const metadata = AppDataSource.getMetadata(slc_item_catalog);
  assert.deepEqual(
    metadata.primaryColumns.map((column) => column.propertyName),
    ['persistentID'],
  );
  assert.equal(metadata.findColumnWithPropertyName('id').isPrimary, false);
  assert.equal(itemResource.idName(), 'id');
  assert.deepEqual(
    itemResource
      .properties()
      .filter((property) => property.isId())
      .map((property) => property.name()),
    ['id'],
  );
  assert.equal(itemResource.property('persistentID').isId(), false);
  const record = (await itemResource.findOne('42')).toJSON();
  assert.equal(record.id, 42);
  assert.equal(record.params.persistentID, persistentID(42));
  // A normal adapter still sees the actual persistent primary key.
  assert.equal(new Resource(slc_item_catalog).idName(), 'persistentID');
  assert.equal(new Resource(slc_item_catalog).property('persistentID').isId(), true);
  assert.equal(AppDataSource.isInitialized, false);
});

for (const action of ['show', 'edit']) {
  test(`${action} route matches and its built-in controller loads the selected record`, async () => {
    const record = (await itemResource.findOne('42')).toJSON();
    const url = helpers.recordActionUrl({
      resourceId: itemResource.id(),
      recordId: String(record.id),
      actionName: action,
    });
    assert.equal(url, `/admin/resources/slc_item_catalog/records/42/${action}`);
    const matches = matchRoutes(
      [
        { path: '/admin/resources/:resourceId/records/:recordId/:actionName', id: 'record' },
        { path: '*', id: 'dashboard' },
      ],
      url,
    );
    assert.equal(matches.at(-1).route.id, 'record');
    const response = await api.recordAction(recordRequest(itemResource, matches.at(-1).params.recordId, action), {});
    assert.equal(response.record.id, 42);
    assert.equal(response.record.params.title, 'Exercise 42');
    assert.equal(response.record.params.persistentID, persistentID(42));
  });
}

test('built-in edit saves the selected entity and retains its persistent ID and indexing hook', async () => {
  const response = await api.recordAction(
    recordRequest(itemResource, 42, 'edit', 'post', { title: 'Changed title' }),
    {},
  );
  assert.equal(response.notice.type, 'success');
  assert.equal(items.get(42).title, 'Changed title');
  assert.equal(items.get(41).title, 'Exercise 41');
  assert.equal(items.get(42).persistentID, persistentID(42));
  assert.equal(indexed[0].id, 42);
  assert.equal(indexed[0].persistentID, persistentID(42));
});

test('individual delete previews on GET, then removes the numeric selection through the entity hook', async () => {
  const preview = await api.recordAction(recordRequest(itemResource, 42, 'delete'), {});
  assert.equal(preview.record.id, 42);
  assert.deepEqual(removed, []);
  const response = await api.recordAction(recordRequest(itemResource, 42, 'delete', 'post'), {});
  assert.equal(response.notice.type, 'success');
  assert.deepEqual(removed, [{ id: 42, persistentID: persistentID(42) }]);
  assert.deepEqual(indexed, [{ deletedId: 42 }]);
  assert.equal(items.has(41), true);
});

for (const count of [1, 3, 100]) {
  test(`built-in bulk selection and deletion resolve exactly ${count} numeric IDs`, async () => {
    const ids = Array.from({ length: count }, (_, i) => String(i + 1));
    const request = resourceRequest(itemResource, 'bulkDelete', { recordIds: ids.join(',') });
    const preview = await api.bulkAction(request, {});
    assert.deepEqual(
      preview.records.map((record) => String(record.id)),
      ids,
    );
    assert.equal(removed.length, 0);
    const response = await api.bulkAction({ ...request, method: 'post' }, {});
    assert.equal(response.notice.type, 'success');
    assert.deepEqual(
      removed.map((row) => String(row.id)),
      ids,
    );
    assert.equal(items.size, 105 - count);
    assert.equal(items.get(105).persistentID, persistentID(105));
    assert.equal(indexed.length, count);
  });
}

test('numeric lookup rejects URL IDs and malformed values without querying MySQL', async () => {
  for (const id of [persistentID(42), '42junk', '-1', '0', '1.5', '9007199254740992']) {
    assert.equal(await itemResource.findOne(id), null);
    assert.deepEqual(await itemResource.findMany(['42', id]), []);
  }
  assert.deepEqual(queries, []);
  const missing = await api.recordAction(recordRequest(itemResource, 999, 'show'), {});
  assert.equal(missing.notice.type, 'error');
});

test('SLC list filtering and matching counts remain delegated to the stock adapter', async () => {
  const response = await api.resourceAction(
    resourceRequest(itemResource, 'list', { 'filters.platform_name': 'Alpha', perPage: '100' }),
    {},
  );
  assert.equal(response.meta.total, 53);
  assert.equal(response.records.length, 53);
  assert.ok(response.records.every((record) => record.params.platform_name === 'Alpha' && record.id % 2 === 1));
  assert.equal(queries.find((query) => query.model === 'items').where.platform_name.type, 'like');
});

test('classification list/show/edit hydrate numeric references and populate the correct SLC item', async () => {
  const list = await api.resourceAction(resourceRequest(classificationResource, 'list', { perPage: '100' }), {});
  assert.equal(list.records[1].params['item.persistentID'], '42');
  assert.equal(list.records[1].populated['item.persistentID'].id, 42);
  for (const action of ['show', 'edit']) {
    const response = await api.recordAction(recordRequest(classificationResource, 2, action), {});
    assert.equal(response.record.params['item.persistentID'], '42');
    assert.equal(response.record.populated['item.persistentID'].params.persistentID, persistentID(42));
  }
  const records = await classificationResource.findMany(['1', '2']);
  assert.deepEqual(
    records.map((record) => record.params['item.persistentID']),
    ['2', '42'],
  );
  assert.equal(classifications.get(2).item.persistentID, persistentID(42));
});

test('classification create and edit translate numeric selections back to exact persistent foreign keys', async () => {
  const created = await api.resourceAction(
    resourceRequest(classificationResource, 'new', {}, 'post', { 'item.persistentID': '42' }),
    {},
  );
  assert.equal(created.notice.type, 'success');
  assert.equal(created.record.params['item.persistentID'], '42');
  assert.equal(created.record.populated['item.persistentID'].id, 42);
  assert.equal(classifications.get(created.record.id).item.persistentID, persistentID(42));
  const updated = await api.recordAction(
    recordRequest(classificationResource, 1, 'edit', 'post', { 'item.persistentID': '42', 'item.id': 2 }),
    {},
  );
  assert.equal(updated.notice.type, 'success');
  assert.equal(updated.record.params['item.persistentID'], '42');
  assert.equal(updated.record.populated['item.persistentID'].id, 42);
  assert.equal(classifications.get(1).item.persistentID, persistentID(42));
  assert.deepEqual(savedReferences, [persistentID(42), persistentID(42)]);
  assert.equal(items.get(42).persistentID, persistentID(42));
});

test('classification reference filters translate numeric IDs without mutating the input filter', async () => {
  const filter = new Filter({ 'item.persistentID': '42' }, classificationResource);
  const records = await classificationResource.find(filter, { limit: 100, sort: { sortBy: 'id', direction: 'asc' } });
  assert.deepEqual(
    records.map((record) => record.id()),
    [2],
  );
  assert.equal(await classificationResource.count(filter), 1);
  assert.equal(filter.filters['item.persistentID'].value, '42');
  const options = queries.find((query) => query.model === 'classifications');
  assert.deepEqual(options.where.item, { persistentID: persistentID(42) });
  const [sql, parameters] = AppDataSource.getRepository(ItemClassification)
    .createQueryBuilder('classification')
    .setFindOptions({ where: options.where })
    .getQueryAndParameters();
  assert.match(sql, /item_id/);
  assert.ok(parameters.includes(persistentID(42)));
  const [joinedSql] = AppDataSource.getRepository(ItemClassification)
    .createQueryBuilder('classification')
    .setFindOptions({ relations: { item: true } })
    .getQueryAndParameters();
  assert.match(joinedSql, /persistentID.*=.*item_id/);
  const response = await api.resourceAction(
    resourceRequest(classificationResource, 'list', { 'filters.item.persistentID': '42', perPage: '100' }),
    {},
  );
  assert.equal(response.meta.total, 1);
  assert.equal(response.records[0].id, 2);
});

test('classification nested input translates only the item relation and preserves its ontology selection', async () => {
  const created = await classificationResource.create({ item: { persistentID: '42' }, ontologyClass: { id: '7' } });
  assert.equal(classifications.get(created.id).item.persistentID, persistentID(42));
  assert.equal(classifications.get(created.id).ontologyClass.id, 7);
  assert.equal(created['item.persistentID'], '42');
});

test('reference search options retain numeric identity and the exact URL-valued persistent ID', async () => {
  const request = resourceRequest(itemResource, 'search');
  request.params.query = 'Exercise 42';
  const response = await api.resourceAction(request, {});
  assert.equal(response.records.length, 1);
  assert.equal(response.records[0].id, 42);
  assert.equal(response.records[0].params.persistentID, persistentID(42));
});

test('classification edits omitting the item field preserve the existing persistent reference', async () => {
  const response = await api.recordAction(recordRequest(classificationResource, 1, 'edit', 'post', {}), {});
  assert.equal(response.notice.type, 'success');
  assert.equal(classifications.get(1).item.persistentID, persistentID(2));
  assert.equal(response.record.params['item.persistentID'], '2');
  assert.equal(response.record.populated['item.persistentID'].id, 2);
});

test('unknown classification selections fail before save and filters never broaden to all records', async () => {
  for (const id of ['999', persistentID(42), '42junk', null]) {
    await assert.rejects(classificationResource.create({ 'item.persistentID': id }), ValidationError);
    await assert.rejects(classificationResource.update(1, { item: { persistentID: id } }), ValidationError);
  }
  const filter = new Filter({ 'item.persistentID': '999' }, classificationResource);
  assert.deepEqual(await classificationResource.find(filter, {}), []);
  assert.equal(await classificationResource.count(filter), 0);
  assert.deepEqual(savedReferences, []);
  assert.equal(classifications.get(1).item.persistentID, persistentID(2));
});
