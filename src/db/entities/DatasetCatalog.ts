import { Entity, PrimaryGeneratedColumn, PrimaryColumn, Column } from 'typeorm';

@Entity('dataset_catalog')
export class dataset_catalog {
  @PrimaryGeneratedColumn()
  id!: number;

  //change #6
  @PrimaryColumn({ length: 255 })
  persistent_identifier!: string;

  @Column({ length: 255 })
  title!: string;

  @Column({ length: 255 })
  platform!: string;

  @Column({ length: 255 })
  datasetName!: string;

  @Column({ length: 255 })
  url!: string;

  @Column('text')
  description!: string;

  @Column('json')
  dataFormats!: string[];

  @Column('json')
  dataType!: string[];

  @Column('json')
  keywords!: string[];

  @Column({ nullable: true })
  population?: string;

  @Column('json', { nullable: true })
  contributors!: Contributor[];

  @Column({ nullable: true })
  language?: string;

  @Column()
  publicationYear!: number;
}

interface Contributor {
  name?: string;
  affiliation: string;
}
