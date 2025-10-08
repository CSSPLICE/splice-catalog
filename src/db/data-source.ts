import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { slc_item_catalog } from './entities/SLCItemCatalog.js';
import { slc_tools_catalog } from './entities/SLCToolsCatalog.js';
import { dataset_catalog } from './entities/DatasetCatalog.js';
import { OntologyClasses } from './entities/OntologyClass.js';
import { OntologyRelations } from './entities/OntologyRelation.js';
import { OntologyAliases } from './entities/OntologyAlias.js';
import { ItemClassification } from './entities/ItemClassification.js';
import { ValidationResults } from './entities/ValidationResults.js';
import { SeedInitialSchema1759958275364 } from './migrations/1759958275364-SeedInitialSchema.js';

dotenv.config();

export const AppDataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST || 'db',
  port: Number(process.env.DB_PORT) || 3306,
  username: process.env.DB_USER || 'splice',
  password: process.env.DB_PASSWORD || 'splice',
  database: process.env.DB_DATABASE || 'splice',
  migrations: [
    SeedInitialSchema1759958275364,
  ],
  logging: process.env.ORM_LOGGING === 'true',
  entities: [
    slc_item_catalog,
    slc_tools_catalog,
    dataset_catalog,
    OntologyClasses,
    OntologyRelations,
    OntologyAliases,
    ItemClassification,
    ValidationResults,
  ],
  synchronize: false,
  subscribers: [],
  migrationsRun: true,
});
