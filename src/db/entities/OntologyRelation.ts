import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { OntologyClasses } from './OntologyClass';

@Entity()
export class OntologyRelations {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => OntologyClasses)
  parent_class!: OntologyClasses;

  @ManyToOne(() => OntologyClasses)
  child_class!: OntologyClasses;

  @Column({ type: 'varchar', default: 'subClassOf' })
  relationship_type!: string;
}
