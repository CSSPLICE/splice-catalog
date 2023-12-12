import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn } from 'typeorm';

@Entity()
export abstract class slc_item_catalog {
  // @PrimaryGeneratedColumn()
  // id!: number;

  @Column({ nullable: false })
  catalog_type!: string;

  @Column()
  url!: string;

  @Column()
  keywords!: string;

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

  @PrimaryColumn()
  // @Column()
  exercise_name!: string;

  @Column()
  iframe_url!: string;

  @Column()
  lti_url!: string;
}
