import { Resource } from '@adminjs/typeorm';
import type { slc_item_catalog } from '../db/entities/SLCItemCatalog.js';

/** Use the existing unique numeric column for AdminJS URLs, not the database primary key. */
export class SlcItemAdminResource extends Resource {
  constructor(model: typeof slc_item_catalog) {
    super(model);
    // These properties belong to this adapter. Never change TypeORM's column metadata.
    for (const property of this.properties()) {
      property.isId = () => property.name() === 'id';
    }
  }

  override idName(): string {
    return 'id';
  }

  override async findOne(id: string | number) {
    const numericId = this.numericId(id);
    return numericId === null ? null : super.findOne(numericId);
  }

  override async findMany(ids: Array<string | number>) {
    const numericIds = ids.map((id) => this.numericId(id));
    if (numericIds.some((id) => id === null)) return [];
    return super.findMany(numericIds as number[]);
  }

  private numericId(id: string | number): number | null {
    if (!/^\d+$/.test(String(id))) return null;
    const value = Number(id);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
}
