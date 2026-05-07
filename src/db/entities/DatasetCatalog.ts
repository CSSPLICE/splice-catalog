import { Entity, PrimaryGeneratedColumn, Column, BaseEntity } from 'typeorm';

@Entity('dataset_catalog')
export class dataset_catalog extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  platform?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  dataset_name?: string;

  @Column('text', { nullable: true })
  description?: string;

  @Column('text', { nullable: true })
  data_formats?: string[];

  @Column('text', { nullable: true })
  data_type?: string[];

  @Column('text', { nullable: true })
  keywords?: string[];

  @Column('text', { nullable: true })
  contributors!: Contributor[];

  @Column({ type: 'varchar', length: 255, nullable: true })
  publisher?: string;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  resource_url?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  resource_url_type?: string;

  @Column('text', { nullable: true })
  bibtex_source?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  creator?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  given_name?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  family_name?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  name_identifier?: string;

  @Column('text', { nullable: true })
  affiliation?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  availability?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  rights?: string;

  @Column('text', { nullable: true })
  programming_language?: string[];

  @Column({ type: 'varchar', length: 255, nullable: true })
  data_collection_start_date?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  data_collection_end_date?: string;

  @Column({ type: 'int', nullable: true })
  publication_year?: number;

  @Column({ type: 'int', nullable: true })
  number_of_semesters?: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  data_protection?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  measurement_type?: string;

  @Column('text', { nullable: true })
  data_processing?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  population?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  units_number?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  task_number?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  sample_size?: string;

  @Column('text', { nullable: true })
  sample_demographics?: string;

  @Column('text', { nullable: true })
  country?: string[];

  @Column({ type: 'varchar', length: 255, nullable: true })
  educational_institution?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  data_standard?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  learning_environment?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  aggregation?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  aggregation_level?: string;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  related_publication_url?: string;

  @Column('text', { nullable: true })
  related_publication?: string;

  @Column('text', { nullable: true })
  research_question?: string;

  @Column('text', { nullable: true })
  future_work?: string;

  @Column('text', { nullable: true })
  fairness_score_text?: string;

  @Column('text', { nullable: true })
  fairness_score?: string;
}

export interface Contributor {
  displayName?: string;
  givenName?: string;
  familyName?: string;
  identifier?: string;
  affiliation?: string;
}
