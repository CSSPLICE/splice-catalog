import { Entity, Column, BaseEntity, PrimaryColumn, Generated, AfterInsert, AfterUpdate, AfterRemove } from 'typeorm';
import { IsNotEmpty, IsString, IsOptional, IsUrl, IsArray } from 'class-validator';
import { CatalogInterface } from './CatalogInterface.js';
import { Reachable, Duplicate } from '../validators.js';
import { meilisearchService } from '../../services/MeilisearchService.js';

@Entity()
export class slc_item_catalog extends BaseEntity implements CatalogInterface {
  @Column({ unique: true })
  @Generated('increment')
  id!: number;

  @Column()
  catalog_type!: string;

  @PrimaryColumn()
  @IsNotEmpty({ context: { severity: 'error' } })
  @IsString({ context: { severity: 'warning' } })
  @Duplicate({ context: { severity: 'notice' } })
  persistentID!: string;

  @Column({ nullable: true })
  @IsNotEmpty({ context: { severity: 'error' } })
  @IsString({ context: { severity: 'warning' } })
  platform_name!: string;

  @Column({ nullable: true })
  @IsNotEmpty({ context: { severity: 'error' } })
  @IsString({ context: { severity: 'error' } })
  @IsUrl(undefined, { context: { severity: 'error' } })
  @Reachable({ context: { severity: 'warning' } })
  iframe_url!: string;

  @Column({ nullable: true })
  @IsOptional({ context: { severity: 'warning' } })
  @IsString({ context: { severity: 'warning' } })
  license?: string;

  @Column('text', { nullable: true })
  @IsNotEmpty({ context: { severity: 'warning' } })
  @IsString({ context: { severity: 'warning' } })
  description!: string;

  @Column('simple-array', { nullable: true })
  @IsNotEmpty({ context: { severity: 'error' } })
  @IsArray({ context: { severity: 'warning' } })
  @IsString({ each: true, context: { severity: 'warning' } })
  author!: string[];

  @Column('simple-array', { nullable: true })
  @IsNotEmpty({ context: { severity: 'error' } })
  @IsArray({ context: { severity: 'warning' } })
  @IsString({ each: true, context: { severity: 'warning' } })
  institution!: string[];

  @Column('simple-array', { nullable: true })
  @IsNotEmpty({ context: { severity: 'error' } })
  @IsArray({ context: { severity: 'warning' } })
  @IsString({ each: true, context: { severity: 'warning' } })
  keywords!: string[];

  @Column('simple-array', { nullable: true })
  @IsNotEmpty({ context: { severity: 'error' } })
  @IsArray({ context: { severity: 'warning' } })
  @IsString({ each: true, context: { severity: 'warning' } })
  features!: string[];

  @Column({ nullable: true })
  @IsNotEmpty({ context: { severity: 'error' } })
  @IsString({ context: { severity: 'warning' } })
  title!: string;

  @Column('simple-array', { nullable: true })
  @IsOptional({ context: { severity: 'warning' } })
  @IsArray({ context: { severity: 'warning' } })
  @IsString({ each: true, context: { severity: 'warning' } })
  programming_language?: string[];

  @Column('simple-array', { nullable: true })
  @IsNotEmpty({ context: { severity: 'error' } })
  @IsArray({ context: { severity: 'warning' } })
  @IsString({ each: true, context: { severity: 'warning' } })
  natural_language!: string[];

  @Column('simple-array', { nullable: true })
  @IsOptional({ context: { severity: 'warning' } })
  @IsArray({ context: { severity: 'warning' } })
  @IsString({ each: true, context: { severity: 'warning' } })
  protocol?: string[];

  @Column('simple-array', { nullable: true })
  @IsOptional({ context: { severity: 'warning' } })
  @IsArray({ context: { severity: 'warning' } })
  @IsString({ each: true, context: { severity: 'warning' } })
  @Reachable({ each: true, context: { severity: 'warning' } })
  protocol_url?: string[];

  @AfterInsert()
  @AfterUpdate()
  async syncToMeilisearch() {
    try {
      await meilisearchService.indexCatalogItems([this]);
      console.log(`✨ Meilisearch: Automatically synced item ${this.id} (${this.title})`);
    } catch (error) {
      console.error(`Meilisearch: Auto-sync failed for item ${this.id}:`, error);
    }
  }

  @AfterRemove()
  async removeFromMeilisearch() {
    try {
      await meilisearchService.deleteItem(this.id);
      console.log(`🗑️ Meilisearch: Automatically removed item ${this.id}`);
    } catch (error) {
      console.error(`Meilisearch: Auto-removal failed for item ${this.id}:`, error);
    }
  }
}
