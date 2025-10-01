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

  @Column()
  author!: string[];

  @Column()
  institution!: string[];

  @Column('json')
  keywords!: string[];

  @Column()
  features!: string[];

  @Column()
  title!: string;

  @Column()
  programming_language?: string[];

  @Column()
  natural_language!: string[];

  @Column()
  protocol?: string[]

  @Column()
  protocol_url?: string[]

  @OneToMany('ValidationResults', (validationResult: any) => validationResult.item, {
    cascade: true,
  })
  validationResults!: any[];
}
