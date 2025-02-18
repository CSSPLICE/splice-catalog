import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn, Index } from 'typeorm';

@Entity()
export class slc_item_catalog {
  @PrimaryGeneratedColumn()
  id!: number;

  // change # 1
  @PrimaryColumn()
  persistent_identifier!: string;

  @Index({unique: true})
  @PrimaryGeneratedColumn("increment")
  index!: number;

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

  @Column()
  author!: string;

  @Column()
  institution!: string;

  @Column()
  language!: string;

  @Column()
  platform_name!: string;

  @Column()
  lti_instructions_url!: string;

  @Column()
  exercise_type!: string;

  @Column({ unique: true })
  exercise_name!: string;

  @Column()
  iframe_url!: string;

  @Column()
  lti_url!: string;
}
