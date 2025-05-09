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

  @Column('simple-array')
  keywords!: string[];

  @Column()
  description!: string;

  @Column('simple-array')
  author!: string[];

  @Column()
  institution!: string;

  @Column()
  programmingLanguage!: string;

  @Column()
  naturalLanguage!: string;

  @Column()
  platform_name!: string;

  @Column()
  lti_instructions_url!: string;

  @Column('simple-array')
  exercise_type!: string[];

  @Column({ unique: true })
  exercise_name!: string;

  @Column()
  iframe_url!: string;

  @Column()
  lti_url!: string;

  @Column({unique: true})
  persistentID!: string;
}
