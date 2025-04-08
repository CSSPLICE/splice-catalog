import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { slc_item_catalog } from './entities/SLCItemCatalog';
import { slc_tools_catalog } from './entities/SLCToolsCatalog';
import { dataset_catalog } from './entities/DatasetCatalog';
import { OntologyClasses } from './entities/OntologyClass';
import { OntologyRelations } from './entities/OntologyRelation';
import { OntologyAliases } from './entities/OntologyAlias';
import { ItemClassification } from './entities/ItemClassification';
// import { CreateSPLICECatalog1699653593228 } from './migrations/1699653593228-CreateSPLICECatalog';
import { CreateSLCToolsCatalog1708095482368 } from './migrations/1708095482368-CreateSLCToolsCatalog';
import { CreateDatasetCatalog1708977188986 } from './migrations/1708977188986-CreateDatasetCatalog';
import { CreateSpliceCatalog1710861730789 } from './migrations/1710861730789-CreateSpliceCatalog';
import { CreateOntologyClasses1727750586131 } from './migrations/1727750586131-CreateOntologyClasses';
import { CreateOntologyAliases1727750762837 } from './migrations/1727750762837-CreateOntologyAliases';
import { CreateOntologyRelations1727750789779 } from './migrations/1727750789779-CreateOntologyRelations';
import { CreateItemClassification1727750775894 } from './migrations/1727750775894-CreateItemClassification';
import { CreateValidationResults1743975897306 } from './migrations/1743975897306-CreateValidationResults';
//import {AddRelationToValidationResults1744043458304} from './migrations/1744043458304-AddRelationToValidationResults';
import { ValidationResults } from './entities/ValidationResults';

dotenv.config();

export const AppDataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST || 'db',
  port: Number(process.env.DB_PORT) || 3306,
  username: process.env.DB_USER || 'splice',
  password: process.env.DB_PASSWORD || 'splice',
  database: process.env.DB_DATABASE || 'splice',
  migrations: [
    CreateSpliceCatalog1710861730789,
    CreateSLCToolsCatalog1708095482368,
    CreateDatasetCatalog1708977188986,
    CreateOntologyClasses1727750586131,
    CreateOntologyRelations1727750789779,
    CreateOntologyAliases1727750762837,
    CreateItemClassification1727750775894,
    CreateValidationResults1743975897306,
    //AddRelationToValidationResults1744043458304,
    // SeedInitialData1699653979099,  // seed migration runs, #Todo include import for dev environment
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
