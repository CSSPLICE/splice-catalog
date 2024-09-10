import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { slc_item_catalog } from './entities/SLCItemCatalog';
import { slc_tools_catalog } from './entities/SLCToolsCatalog';
import { dataset_catalog } from './entities/DatasetCatalog';
// import { CreateSPLICECatalog1699653593228 } from './migrations/1699653593228-CreateSPLICECatalog';
import { CreateSLCToolsCatalog1708095482368 } from './migrations/1708095482368-CreateSLCToolsCatalog';
import { CreateDatasetCatalog1708977188986 } from './migrations/1708977188986-CreateDatasetCatalog';
import { CreateSpliceCatalog1710861730789 } from './migrations/1710861730789-CreateSpliceCatalog';

dotenv.config();

export const AppDataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST || 'db',
  port: Number(process.env.DB_PORT) || 3306,
  username: process.env.DB_USER || 'splice',
  password: process.env.DB_PASSWORD || 'splice',
  database: process.env.DB_DATABASE || 'splice',
  migrations: [CreateSpliceCatalog1710861730789, CreateSLCToolsCatalog1708095482368, CreateDatasetCatalog1708977188986],
  logging: process.env.ORM_LOGGING === 'true',
  entities: [slc_item_catalog, slc_tools_catalog, dataset_catalog],
  synchronize: false,
  subscribers: [],
  migrationsRun: true,
});
