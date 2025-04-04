import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OntologyClasses } from './OntologyClass';

@Entity('ontology_aliases')
export class OntologyAliases {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => OntologyClasses, (ontologyClass) => ontologyClass.aliases, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'class_id' })
  class!: OntologyClasses;

  @Column({ type: 'varchar', unique: true })
  alias!: string;

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
