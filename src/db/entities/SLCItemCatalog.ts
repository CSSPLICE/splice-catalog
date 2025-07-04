import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn, OneToMany } from 'typeorm';
import { ValidationResults } from './ValidationResults';

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

  @OneToMany(() => ValidationResults, (validationResult) => validationResult.item, {
    cascade: true,
  })
  validationResults!: ValidationResults[];
}
