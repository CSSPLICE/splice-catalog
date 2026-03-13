import { Entity, Column, BaseEntity, PrimaryColumn, Generated, AfterInsert, AfterUpdate, AfterRemove } from 'typeorm';
import { IsNotEmpty, IsString, IsOptional, IsUrl, IsArray } from 'class-validator';
import { CatalogInterface } from './CatalogInterface.js';
import { Reachable } from '../validators.js';
import { meilisearchService } from '../../services/MeilisearchService.js';
// import { ValidationResults } from './ValidationResults.js';

@Entity()
export class slc_item_catalog extends BaseEntity implements CatalogInterface {
  @Column({ unique: true })
  @Generated('increment')
  id!: number;

  @Column()
  @IsNotEmpty()
  @IsString()
  catalog_type!: string;

  @PrimaryColumn()
  @IsNotEmpty()
  @IsString()
  persistentID!: string;

  @Column({ nullable: true })
  @IsNotEmpty()
  @IsString()
  platform_name!: string;

  @Column({ nullable: true })
  @IsNotEmpty()
  @IsString()
  @IsUrl()
  @Reachable()
  iframe_url!: string;

  @Column({ nullable: true })
  @IsOptional()
  @IsString()
  license?: string;

  @Column('text', { nullable: true })
  @IsNotEmpty()
  @IsString()
  description!: string;

  @Column('simple-array', { nullable: true })
  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  author!: string[];

  @Column('simple-array', { nullable: true })
  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  institution!: string[];

  @Column('simple-array', { nullable: true })
  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  keywords!: string[];

  @Column('simple-array', { nullable: true })
  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  features!: string[];

  @Column({ nullable: true })
  @IsNotEmpty()
  @IsString()
  title!: string;

  @Column('simple-array', { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  programming_language?: string[];

  @Column('simple-array', { nullable: true })
  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  natural_language!: string[];

  @Column('simple-array', { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  protocol?: string[];

  @Column('simple-array', { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Reachable()
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
