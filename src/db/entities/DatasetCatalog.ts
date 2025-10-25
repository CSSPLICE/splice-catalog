import { Entity, PrimaryGeneratedColumn, Column, BaseEntity } from 'typeorm';

@Entity('dataset_catalog')
export class dataset_catalog extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ length: 255 })
  title!: string;

  @Column({ length: 255 })
  platform!: string;

  @Column({ length: 255 })
  datasetName!: string;

  @Column('text')
  description!: string;

  @Column('json')
  dataFormats!: string[];

  @Column('json')
  dataType!: string[];

  @Column('json')
  keywords!: string[];

  @Column('json', { nullable: true })
  contributors!: Contributor[];

  @Column({ nullable: true })
  language?: string;

  @Column()
  publicationYear!: number;

  @Column({ length: 255, nullable: true })
  publisher?: string;

  @Column({ length: 1024, nullable: true })
  resourceUrl?: string;

  @Column({ length: 255, nullable: true })
  resourceUrlType?: string;

  @Column({ length: 1024, nullable: true })
  bibtexSource?: string;

  @Column({ length: 255, nullable: true })
  rights?: string;

  @Column({ length: 255, nullable: true })
  availability?: string;

  @Column({ type: 'float', nullable: true })
  fairnessScore?: number;

  @Column('json', { nullable: true })
  programmingLanguages?: string[];

  @Column({ type: 'date', nullable: true })
  dataCollectionStartDate?: string;

  @Column({ type: 'date', nullable: true })
  dataCollectionEndDate?: string;

  @Column({ type: 'int', nullable: true })
  taskNumber?: number;

  @Column({ type: 'int', nullable: true })
  sampleSize?: number;

  @Column('text', { nullable: true })
  sampleDemographics?: string;

  @Column('json', { nullable: true })
  country?: string[];

  @Column({ length: 255, nullable: true })
  educationalInstitution?: string;

  @Column({ length: 255, nullable: true })
  dataStandard?: string;

  @Column({ length: 255, nullable: true })
  learningEnvironment?: string;

  @Column({ length: 255, nullable: true })
  aggregation?: string;

  @Column({ length: 255, nullable: true })
  aggregationLevel?: string;

  @Column({ length: 1024, nullable: true })
  relatedPublicationUrl?: string;

  @Column('text', { nullable: true })
  relatedPublication?: string;

  @Column('text', { nullable: true })
  researchQuestion?: string;

  @Column('text', { nullable: true })
  futureWork?: string;
}

export interface Contributor {
  displayName?: string;
  givenName?: string;
  familyName?: string;
  identifier?: string;
  affiliation?: string;
}
