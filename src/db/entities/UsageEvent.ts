import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, BaseEntity } from 'typeorm';

@Entity('usage_events')
export class UsageEvent extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  itemPersistentID!: string;

  @Column()
  itemTitle!: string;

  @Column()
  eventType!: string;

  @Column({ nullable: true })
  linkType?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  catalogType!: string | null;
  
  @Column({ type: 'varchar', length: 255, nullable: true })
  catalogPath!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
