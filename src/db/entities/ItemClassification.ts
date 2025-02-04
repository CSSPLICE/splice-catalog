import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { slc_item_catalog } from './SLCItemCatalog';
import { OntologyClasses } from './OntologyClass';

@Entity('item_classification')
export class ItemClassification {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => slc_item_catalog, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'item_id' })
  item!: slc_item_catalog;

  @ManyToOne(() => OntologyClasses, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'class_id' })
  ontologyClass!: OntologyClasses;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  classified_at!: Date;
}
