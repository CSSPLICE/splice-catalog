import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { slc_item_catalog } from './SLCItemCatalog';
import { OntologyClasses } from './OntologyClass';

@Entity()
export class ItemClassification {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => slc_item_catalog)
  @JoinColumn({ name: 'item_id' }) 
  item!: slc_item_catalog;

  @ManyToOne(() => OntologyClasses)
  @JoinColumn({ name: 'class_id' }) 
  class!: OntologyClasses;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  classified_at!: Date;
}

