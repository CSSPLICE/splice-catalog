import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { OntologyAliases } from './OntologyAlias';
import { OntologyRelations } from './OntologyRelation';

@Entity('ontology_classes') 
export class OntologyClasses {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', unique: true })
  class_uri!: string;

  @Column({ type: 'varchar' })
  label!: string;

  @Column({ type: 'text', nullable: true })
  comment!: string;

  @Column({ type: 'text', nullable: true })
  description!: string;

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  @OneToMany(() => OntologyAliases, (ontologyAlias) => ontologyAlias.class, {
    cascade: true, 
  })
  aliases!: OntologyAliases[];

  @OneToMany(() => OntologyRelations, (ontologyRelation) => ontologyRelation.parent_class)
  parentRelations!: OntologyRelations[];

  @OneToMany(() => OntologyRelations, (ontologyRelation) => ontologyRelation.child_class)
  childRelations!: OntologyRelations[];
}
