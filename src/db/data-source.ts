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
import { SearchAlias } from './entities/SearchAlias.js';
import { ValidationJob } from './entities/ValidationJob.js';
import { ValidationJobConstraint } from './entities/ValidationJobConstraint.js';
import { UsageEvent } from './entities/UsageEvent.js';
import { HistoricalUsage } from './entities/HistoricalUsage.js';
import { SearchEvent } from './entities/SearchEvent.js';

dotenv.config();

export const AppDataSource: DataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST || 'db',
  port: Number(process.env.DB_PORT) || 3306,
  username: process.env.DB_USERNAME || 'splice',
  password: process.env.DB_PASSWORD || 'splice',
  database: process.env.DB_DATABASE || 'splice',
  migrations: [
    process.env.NODE_ENV === 'development'
      ? 'src/db/migrations/*.ts'
      : 'dist/db/migrations/*.js',
  ],
  // SQL parameters can contain submitted search terms; keep them out of production logs.
  logging: process.env.NODE_ENV !== 'production' && process.env.ORM_LOGGING === 'true',
  entities: [
    slc_item_catalog,
    slc_tools_catalog,
    dataset_catalog,
    OntologyClasses,
    OntologyRelations,
    OntologyAliases,
    ItemClassification,
    ValidationResults,
    SearchAlias,
    ValidationJob,
    ValidationJobConstraint,
    UsageEvent,
    HistoricalUsage,
    SearchEvent,
  ],
  synchronize: false,
  subscribers: [],
  migrationsRun: false,
});
