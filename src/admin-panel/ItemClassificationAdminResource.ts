import { Resource } from '@adminjs/typeorm';
import { BaseRecord, Filter, ValidationError, flat } from 'adminjs';
import { In } from 'typeorm';
import type { ItemClassification } from '../db/entities/ItemClassification.js';
import type { SlcItemAdminResource } from './SlcItemAdminResource.js';

// Keep the adapter's relation path, but expose numeric IDs there to AdminJS's reference widgets.
const ITEM_REFERENCE = 'item.persistentID';
type AdminParams = Parameters<Resource['create']>[0];

/** Translate the persistent-ID foreign key to/from the SLC resource's numeric AdminJS identity. */
export class ItemClassificationAdminResource extends Resource {
  constructor(
    private readonly classificationModel: typeof ItemClassification,
    private readonly items: SlcItemAdminResource,
  ) {
    super(classificationModel);
  }

  override async find(filter: Filter, params: Parameters<Resource['find']>[1]) {
    const translated = await this.databaseFilter(filter);
    if (!translated) return [];
    return this.withItemReferences(await super.find(translated, params));
  }

  override async count(filter: Filter) {
    const translated = await this.databaseFilter(filter);
    return translated ? super.count(translated) : 0;
  }

  override async findOne(id: string | number) {
    const record = await super.findOne(id);
    return record ? (await this.withItemReferences([record]))[0] : null;
  }

  override async findMany(ids: Array<string | number>) {
    return this.withItemReferences(await super.findMany(ids));
  }

  override async create(params: AdminParams) {
    const instance = await super.create(await this.databaseParams(params));
    return (await this.withItemReferences([new BaseRecord(instance, this)]))[0].params;
  }

  override async update(id: string | number, params: AdminParams = {}) {
    const instance = await super.update(id, await this.databaseParams(params));
    return (await this.withItemReferences([new BaseRecord(instance, this)]))[0].params;
  }

  private async databaseParams(params: AdminParams): Promise<AdminParams> {
    const values = flat.unflatten(params);
    if (!Object.hasOwn(values, 'item')) return params;

    const selected = await this.items.findOne(flat.get(flat.flatten(values), ITEM_REFERENCE));
    if (!selected) {
      throw new ValidationError({
        [ITEM_REFERENCE]: { type: 'reference', message: 'Select an existing catalog item.' },
      });
    }
    // Replace the whole relation so a stale or submitted item.id cannot override the selection.
    return flat.flatten({ ...values, item: { persistentID: selected.params.persistentID } });
  }

  private async databaseFilter(filter: Filter): Promise<Filter | null> {
    const reference = filter?.filters[ITEM_REFERENCE];
    if (!reference) return filter;
    const selected = await this.items.findOne(reference.value as string);
    if (!selected) return null;

    const translated = new Filter({}, this);
    translated.filters = { ...filter.filters };
    delete translated.filters[ITEM_REFERENCE];
    // The stock reference parser produces a scalar relation condition. TypeORM needs
    // a nested condition for this string foreign key; use the adapter's custom-filter support.
    const relationFilter = { ...reference, custom: { persistentID: selected.params.persistentID } };
    translated.filters.item = relationFilter;
    return translated;
  }

  private async withItemReferences(records: BaseRecord[]): Promise<BaseRecord[]> {
    if (!records.length) return records;
    // The stock adapter does not load ManyToOne relations. Load this reference in one batch.
    const classifications = await this.classificationModel.find({
      where: { id: In(records.map((record) => record.id())) },
      relations: { item: true },
    });
    const itemIds = new Map(classifications.map((row) => [String(row.id), row.item?.id]));
    for (const record of records) {
      const itemId = itemIds.get(String(record.id()));
      record.set('item', itemId == null ? null : { persistentID: String(itemId) });
    }
    return records;
  }
}
