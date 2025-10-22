import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, BaseEntity } from 'typeorm';

@Entity('item_classification')
export class ItemClassification extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne('slc_item_catalog', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'item_id' })
  item!: any;

  @ManyToOne('OntologyClasses', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'class_id' })
  ontologyClass!: any;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  classified_at!: Date;
}
