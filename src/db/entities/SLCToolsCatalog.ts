import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('slc_tools_catalog')
export class slc_tools_catalog {
  @PrimaryColumn()
  platform_name!: string;

  @Column()
  url!: string;

  @Column({ nullable: true })
  tool_description!: string;

  @Column({ nullable: true })
  license!: string;

  @Column({ nullable: true})
  standard_support!: string;

  @Column({ nullable: true })
  keywords!: string;

  @Column({ nullable: true })
  contact_email!: string;
}
