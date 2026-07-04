import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index, BaseEntity } from 'typeorm';
import type { ValidationJob } from './ValidationJob.js';

export type Severity = 'error' | 'warning' | 'notice';

export interface RichConstraint {
  message: string;
  severity: Severity;
}

@Entity('validation_job_constraint')
export class ValidationJobConstraint extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  persistentID!: string;

  @Column({ type: 'varchar', length: 255 })
  property!: string;

  @Column({ type: 'json' })
  constraints!: Record<string, RichConstraint>;

  @Column({ type: 'varchar', length: 36 })
  job_id!: string;

  @ManyToOne('ValidationJob', (job: ValidationJob) => job.constraints, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'job_id' })
  job!: ValidationJob;
}
