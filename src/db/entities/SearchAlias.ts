import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, BaseEntity } from 'typeorm';

@Entity('search_aliases')
export class SearchAlias extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 255 })
  term!: string;

  @Column({ type: 'varchar', length: 255 })
  synonym!: string;

  @Column({ type: 'tinyint', default: 1 })
  is_active!: number;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  created_at!: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6 })
  updated_at!: Date;
}
