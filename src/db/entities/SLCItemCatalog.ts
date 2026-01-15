import { Entity, Column, BaseEntity, PrimaryColumn, Generated } from 'typeorm';
import { IsNotEmpty, IsString, IsOptional, IsUrl, IsArray } from 'class-validator';
import { CatalogInterface } from './CatalogInterface.js';
import { Reachable } from "../validators.js";
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

  @Column()
  @IsNotEmpty()
  @IsString()
  platform_name!: string;

  @Column()
  @IsNotEmpty()
  @IsString()
  @IsUrl()
  @Reachable()
  iframe_url!: string;

  @Column()
  @IsOptional()
  @IsString()
  license?: string;

  @Column('text')
  @IsNotEmpty()
  @IsString()
  description!: string;

  @Column('simple-array')
  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  author!: string[];

  @Column('simple-array')
  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  institution!: string[];

  @Column('simple-array')
  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  keywords!: string[];

  @Column('simple-array')
  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  features!: string[];

  @Column()
  @IsNotEmpty()
  @IsString()
  title!: string;

  @Column('simple-array')
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  programming_language?: string[];

  @Column('simple-array')
  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  natural_language!: string[];

  @Column('simple-array')
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  protocol?: string[];

  @Column('simple-array')
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Reachable()
  protocol_url?: string[];
}
