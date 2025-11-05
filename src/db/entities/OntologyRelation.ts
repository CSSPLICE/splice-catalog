import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, BaseEntity } from 'typeorm';

@Entity()
export class OntologyRelations extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne('OntologyClasses', (ontologyClass: any) => ontologyClass.aliases, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'parent_class_id' })
  parent_class!: any;

  @ManyToOne('OntologyClasses', (ontologyClass: any) => ontologyClass.aliases, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'child_class_id' })
  child_class!: any;

  @Column({ type: 'varchar', default: 'subClassOf' })
  relationship_type!: string;
}
