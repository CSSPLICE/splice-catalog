import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  OneToMany,
  BaseEntity,
} from 'typeorm';
import { ValidationJobConstraint } from './ValidationJobConstraint.js';

export type CatalogType = 'SLCItem' | 'SLCToolsCatalog' | 'DatasetCatalog';

export type ValidationJobStatus = 'processing' | 'failed' | 'complete';

@Entity('validation_job')
export class ValidationJob extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @CreateDateColumn()
  submitted_at!: Date;

  @Column({ type: 'varchar', length: 64, nullable: true })
  catalog_type?: CatalogType;

  @Column({ type: 'int', default: 0 })
  total!: number;

  @Column({ type: 'int', default: 0 })
  saved!: number;

  @Column({ type: 'int', default: 0 })
  updated!: number;

  @Column({ type: 'int', default: 0 })
  processed!: number;

  @Column({
    type: 'enum',
    enum: ['processing', 'failed', 'complete'],
    default: 'processing',
  })
  status!: ValidationJobStatus;

  @OneToMany(() => ValidationJobConstraint, (constraint) => constraint.job, {
    cascade: true,
  })
  constraints!: ValidationJobConstraint[];
}