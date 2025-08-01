import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn } from 'typeorm';
import { slc_item_catalog } from './SLCItemCatalog';

@Entity('validation_results')
export class ValidationResults {
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

  @ManyToOne(() => slc_item_catalog, (item) => item.validationResults, { nullable: false })
  item!: slc_item_catalog;
}
