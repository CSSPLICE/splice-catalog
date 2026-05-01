import { Entity, PrimaryGeneratedColumn, Column, BaseEntity } from 'typeorm';
import { CatalogInterface } from './CatalogInterface.js';
import { IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';

@Entity()
export class slc_tools_catalog extends BaseEntity implements CatalogInterface {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar' })
  @IsNotEmpty()
  @IsString()
  catalog_type!: string;

  @Column({ type: 'varchar' })
  @IsNotEmpty()
  @IsString()
  platform_name!: string;

  @Column({ type: 'varchar' })
  @IsNotEmpty()
  @IsUrl()
  url!: string;

  @Column({ type: 'varchar', nullable: true })
  @IsNotEmpty()
  @IsString()
  description!: string;

  @Column({ type: 'varchar', nullable: true })
  @IsOptional()
  @IsString()
  license?: string;

  @Column({ type: 'varchar', nullable: true })
  @IsOptional()
  @IsString()
  interface?: string;

  @Column({ type: 'varchar', nullable: true })
  @IsOptional()
  @IsString()
  contact_email!: string;

  @Column({ type: 'varchar', nullable: true })
  @IsOptional()
  @IsString()
  lti_credentials?: string;
}
