import { Entity, PrimaryGeneratedColumn, Column, OneToMany, PrimaryColumn } from 'typeorm';
import { OntologyAliases } from './OntologyAlias';
import { OntologyRelations } from './OntologyRelation';

@Entity('ontology_classes')
export class OntologyClasses {
  @PrimaryGeneratedColumn()
  id!: number;

  //change #5
  @PrimaryColumn()
  persistent_identifier!: string;

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
