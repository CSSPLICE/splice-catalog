import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { OntologyClasses } from './OntologyClass';

@Entity()
export class OntologyAliases {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => OntologyClasses)
  @JoinColumn({ name: 'ontology_class_id' }) 
  class!: OntologyClasses;

  @Column({ type: 'varchar', unique: true })
  alias!: string;

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at!: Date;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updated_at!: Date;
}
