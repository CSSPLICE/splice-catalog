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
import { SeedInitialData1764779460569 } from './migrations/1764779460569-SeedInitialData.js';
import { CreateSearchAliasesTable1771278405273 } from './migrations/1771278405273-CreateSearchAliasesTable.js';
import { SeedSearchAliasesData1771278447647 } from './migrations/1771278447647-SeedSearchAliasesData.js';

dotenv.config();

export const AppDataSource: DataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST || 'db',
  port: Number(process.env.DB_PORT) || 3306,
  username: process.env.DB_USERNAME || 'splice',
  password: process.env.DB_PASSWORD || 'splice',
  database: process.env.DB_DATABASE || 'splice',
  migrations: [SeedInitialData1764779460569, CreateSearchAliasesTable1771278405273, SeedSearchAliasesData1771278447647],
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
    SearchAlias,
  ],
  synchronize: false,
  subscribers: [],
  migrationsRun: false,
});
