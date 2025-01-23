import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { OntologyClasses } from './OntologyClass';

@Entity()
export class OntologyRelations {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => OntologyClasses)
  @JoinColumn({ name: 'parent_class_id' })
  parent_class!: OntologyClasses;

  @ManyToOne(() => OntologyClasses)
  @JoinColumn({ name: 'child_class_id' })
  child_class!: OntologyClasses;

  @Column({ type: 'varchar', default: 'subClassOf' })
  relationship_type!: string;
}
