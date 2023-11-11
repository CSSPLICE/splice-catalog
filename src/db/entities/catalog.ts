import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity()
export class Catalog {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ nullable: false })
  platform_name!: string;

  @Column({ nullable: false })
  url!: string;

  @Column({ nullable: false })
  keywords!: string;

  @Column()
  lti_instructions_url!: string;

  @Column()
  exercise_type!: string;

  @Column()
  description!: string;

  @Column()
  author!: string;

  @Column()
  institution!: string;

  @Column()
  exercise_name!: string;

  @Column()
  iframe_url!: string;

  @Column()
  lti_url!: string;
}
