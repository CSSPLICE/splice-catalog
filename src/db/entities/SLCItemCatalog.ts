import { Entity, PrimaryGeneratedColumn, Column, OneToMany, BaseEntity } from 'typeorm';
// import { ValidationResults } from './ValidationResults.js';

@Entity()
export class slc_item_catalog extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ nullable: false })
  catalog_type!: string;

	@Column({ nullable: false })
	persistentID!: string;

  @Column()
  platform_name!: string;

  @Column()
  iframe_url!: string;

  @Column()
  license?: string

  @Column()
  description!: string;

  @Column('simple-array')
  author!: string[];

  @Column('simple-array')
  institution!: string[];

  @Column('simple-array')
  keywords!: string[];

  @Column('simple-array')
  features!: string[];

  @Column()
  title!: string;

  @Column('simple-array')
  programming_language?: string[];

  @Column('simple-array')
  natural_language!: string[];

  @Column('simple-array')
  protocol?: string[]

  @Column('simple-array')
  protocol_url?: string[]

  @OneToMany('ValidationResults', (validationResult: any) => validationResult.item, {
    cascade: true,
  })
  validationResults!: any[];
}
