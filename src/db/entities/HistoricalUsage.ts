import { BaseEntity, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('historical_usage')
@Index('UQ_historical_usage_source_catalog_legacy', ['source', 'catalogType', 'legacyCatalogId'], { unique: true })
export class HistoricalUsage extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Column({ type: 'varchar', length: 32 })
  catalogType!: string;

  @Column({ type: 'int', unsigned: true })
  legacyCatalogId!: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  itemPersistentID!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  itemTitle!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  catalogPath!: string | null;

  @Column({ type: 'int', unsigned: true })
  viewCount!: number;

  @Column({ type: 'varchar', length: 64 })
  source!: string;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  importedAt!: Date;
}
