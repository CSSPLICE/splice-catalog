import { slc_item_catalog } from '../db/entities/SLCItemCatalog.js';
import { slc_tools_catalog } from '../db/entities/SLCToolsCatalog.js';
import { dataset_catalog } from '../db/entities/DatasetCatalog.js';
import { OntologyClasses } from '../db/entities/OntologyClass.js';
import { OntologyRelations } from '../db/entities/OntologyRelation.js';
import { OntologyAliases } from '../db/entities/OntologyAlias.js';
import { ItemClassification } from '../db/entities/ItemClassification.js';
import { ValidationResults } from '../db/entities/ValidationResults.js';
import AdminJS from 'adminjs';
import { Database, Resource } from '@adminjs/typeorm';
import { buildRouter } from '@adminjs/express';

export function setup() {
  AdminJS.registerAdapter({
    Database,
    Resource,
  });

  const adminJs = new AdminJS({
    resources: [
      { resource: slc_item_catalog },
      { resource: slc_tools_catalog },
      { resource: dataset_catalog },
      { resource: OntologyClasses },
      { resource: OntologyRelations },
      { resource: OntologyAliases },
      { resource: ItemClassification },
      { resource: ValidationResults },
    ],
    rootPath: '/admin',
  });

  return buildRouter(adminJs);
}
