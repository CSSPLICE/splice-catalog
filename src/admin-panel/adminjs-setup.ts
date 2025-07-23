import { slc_item_catalog } from '../db/entities/SLCItemCatalog';
import { slc_tools_catalog } from '../db/entities/SLCToolsCatalog';
import { dataset_catalog } from '../db/entities/DatasetCatalog';
import { OntologyClasses } from '../db/entities/OntologyClass';
import { OntologyRelations } from '../db/entities/OntologyRelation';
import { OntologyAliases } from '../db/entities/OntologyAlias';
import { ItemClassification } from '../db/entities/ItemClassification';
import { ValidationResults } from '../db/entities/ValidationResults';
import AdminJS from 'adminjs';
import { Database, Resource } from '@adminjs/typeorm';
import { buildRouter } from '@adminjs/express';

AdminJS.registerAdapter(
  {
    Database: Database,
    Resource: Resource
  }
)

const adminJs = new AdminJS(
  {
    resources: [
      { resource: slc_item_catalog, options: {} },
      { resource: slc_tools_catalog, options: {} },
      { resource: dataset_catalog, options: {} },
      { resource: OntologyClasses, options: {} },
      { resource: OntologyRelations, options: {} },
      { resource: OntologyAliases, options: {} },
      { resource: ItemClassification, options: {} },
      { resource: ValidationResults, options: {} }
    ],
    rootPath: '/admin'
  }
);

export const adminRouter = buildRouter(adminJs);