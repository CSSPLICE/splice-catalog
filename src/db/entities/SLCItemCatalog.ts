import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn } from 'typeorm';

@Entity()
export class slc_item_catalog {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ nullable: false })
  catalog_type!: string;

  @Column()
  url!: string;

  // @Column()
  // keywords!: string;

  @Column('json')
  keywords!: string[];

  @Column()
  description!: string;

  @Column('json')
  author!: string[];

  @Column()
  institution!: string;

  @Column()
  natural_language!: string;

  @Column()
  programming_language!: string;

  @Column()
  platform_name!: string;

  @Column()
  lti_instructions_url!: string;

  @Column('json')
  exercise_type!: string[];

  @Column({ unique: true })
  exercise_name!: string;

  @Column()
  iframe_url!: string;

  @Column()
  lti_url!: string;

  @Column({unique: true})
  persistent_id!: string;
}
