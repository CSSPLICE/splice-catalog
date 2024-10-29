import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity()
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
}
