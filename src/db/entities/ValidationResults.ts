import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, BaseEntity } from 'typeorm';

@Entity('validation_results')
export class ValidationResults extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  user!: string;

  @CreateDateColumn()
  dateLastUpdated!: Date;

  @Column({ type: 'text', nullable: true })
  metadataIssues!: string;

  @Column({ type: 'boolean', default: false })
  isUrlValid!: boolean;

  @Column({ type: 'text', nullable: true })
  categorizationResults!: string;

  @Column({ type: 'text', nullable: true })
  validationStatus?: string;

  @Column({ type: 'text', nullable: true })
  iframeValidationError?: string;

  @Column({ type: 'text', nullable: true })
  ltiValidationStatus?: string;

  @ManyToOne('slc_item_catalog', (item: any) => item.validationResults, { nullable: false })
  item!: any;
}

// import { slc_item_catalog } from './SLCItemCatalog.js';
