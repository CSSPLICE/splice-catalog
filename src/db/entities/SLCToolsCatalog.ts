import { Entity, PrimaryGeneratedColumn, Column, BaseEntity } from 'typeorm';
import { CatalogInterface } from './CatalogInterface.js';
import { IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';

@Entity()
export class slc_tools_catalog extends BaseEntity implements CatalogInterface {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  @IsNotEmpty()
  @IsString()
  catalog_type!: string;

  @Column()
  @IsNotEmpty()
  @IsString()
  platform_name!: string;

  @Column()
  @IsNotEmpty()
  @IsUrl()
  url!: string;

  @Column({ nullable: true })
  @IsNotEmpty()
  @IsString()
  description!: string;

  @Column({ nullable: true })
  @IsOptional()
  @IsString()
  license?: string;

  @Column({ nullable: true })
  @IsOptional()
  @IsString()
  interface?: string;

  @Column({ nullable: true })
  @IsOptional()
  @IsString()
  contact_email!: string;

  @Column({ nullable: true })
  @IsOptional()
  @IsString()
  lti_credentials?: string;
}
