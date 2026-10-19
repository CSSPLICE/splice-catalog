import { BaseEntity, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type SearchSource = 'WEB' | 'API';

@Entity('search_events')
@Index('IDX_search_events_source_createdAt', ['source', 'createdAt'])
export class SearchEvent extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'enum', enum: ['WEB', 'API'] })
  source!: SearchSource;

  @Column({ type: 'varchar', length: 500 })
  query!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  catalogType!: string | null;

  @Column({ type: 'int', unsigned: true, nullable: true })
  resultCount!: number | null;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt!: Date;
}
