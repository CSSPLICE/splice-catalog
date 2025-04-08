import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn } from 'typeorm';
import { slc_item_catalog } from './SLCItemCatalog';

@Entity('validation_results')
export class ValidationResults {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  user!: string;

  @CreateDateColumn()
  dateLastUpdated!: Date;

  @Column({ type: 'text', nullable: true })
  metadataIssues!: string;

  @Column({ type: 'boolean', default: false })
  isUrlValid!: boolean;

  @Column({ type: 'text', nullable: true })
  categorizationResults!: string;

  @Column({ type: 'text', nullable: true })
  validationStatus?: string;

  @ManyToOne(() => slc_item_catalog, (item) => item.validationResults, { nullable: false })
  item!: slc_item_catalog;
}

//yarn typeorm migration:generate -n CreateValidationResultsTable
/*
    "catalog_type": "SLCItemCatalog",
    "platform_name": "OpenDSA",
    "url": "https://opendsa-lti.localhost.devcom.vt.edu/embed/TriangleApplet",
    "lti_instructions_url": "https://opendsa-server.cs.vt.edu/guides/opendsa-canvas",
    "exercise_type": null,
    "license": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)",
    "description": null,
    "author": "Cliff Shaffer",
    "institution": "Virginia Tech",
    "keywords": ["Triangle Testing No Code"],
    "exercise_name": "Triangle Testing No Code",
    "iframe_url": "https://opendsa-lti.localhost.devcom.vt.edu/embed/TriangleApplet",
    "lti_url": "https://opendsa-lti.localhost.devcom.vt.edu/lti/launch?custom_ex_short_name=TriangleApplet"

    type
    platform
    url
    lti instructionsurl/url
    exercise type
    license
    description
    author
    institution
    keywrods
    exerscise name
    ifram url

*/
