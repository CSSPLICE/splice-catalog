import { Entity, PrimaryGeneratedColumn, Column, OneToMany, BaseEntity } from 'typeorm';

@Entity('ontology_classes')
export class OntologyClasses extends BaseEntity {
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

  @OneToMany('OntologyAliases', (ontologyAlias: any) => ontologyAlias.class, {
    cascade: true,
  })
  aliases!: any[];

  @OneToMany('OntologyRelations', (ontologyRelation: any) => ontologyRelation.parent_class)
  parentRelations!: any[];

  @OneToMany('OntologyRelations', (ontologyRelation: any) => ontologyRelation.child_class)
  childRelations!: any[];
}
