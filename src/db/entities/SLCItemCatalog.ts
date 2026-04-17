import { Entity, Column, BaseEntity, PrimaryColumn, Generated } from 'typeorm';
import { IsNotEmpty, IsString, IsOptional, IsUrl, IsArray } from 'class-validator';
import { CatalogInterface } from './CatalogInterface.js';
import { Reachable } from '../validators.js';

@Entity()
export class slc_item_catalog extends BaseEntity implements CatalogInterface {
  @Column({ type: 'int', unique: true })
  @Generated('increment')
  id!: number;

  @Column({ type: 'varchar' })
  catalog_type!: string;

  @PrimaryColumn({ type: 'varchar' })
  @IsNotEmpty({ context: { severity: 'error' } })
  @IsString({ context: { severity: 'warning' } })
  persistentID!: string;

  @Column({ type: 'varchar', nullable: true })
  @IsNotEmpty({ context: { severity: 'error' } })
  @IsString({ context: { severity: 'warning' } })
  platform_name!: string;

  @Column({ type: 'varchar', nullable: true })
  @IsNotEmpty({ context: { severity: 'error' } })
  @IsString({ context: { severity: 'error' } })
  @IsUrl(undefined, { context: { severity: 'error' } })
  @Reachable({ context: { severity: 'warning' } })
  iframe_url!: string;

  @Column({ type: 'varchar', nullable: true })
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

  @Column({ type: 'varchar', nullable: true })
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
  @Reachable({ context: { severity: 'warning' } })
  protocol_url?: string[];
}
