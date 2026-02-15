import { slc_item_catalog } from '../db/entities/SLCItemCatalog.js';
import { slc_tools_catalog } from '../db/entities/SLCToolsCatalog.js';
import { dataset_catalog } from '../db/entities/DatasetCatalog.js';
import { OntologyClasses } from '../db/entities/OntologyClass.js';
import { OntologyRelations } from '../db/entities/OntologyRelation.js';
import { OntologyAliases } from '../db/entities/OntologyAlias.js';
import { ItemClassification } from '../db/entities/ItemClassification.js';
import { ValidationResults } from '../db/entities/ValidationResults.js';
import { AdminJS, ResourceOptions } from 'adminjs';
import { Database, Resource } from '@adminjs/typeorm';
import { AppDataSource } from '../db/data-source.js';
import AdminJSExpress from '@adminjs/express';
const { buildRouter } = AdminJSExpress;

export function setup() {
  AdminJS.registerAdapter({
    Database,
    Resource,
  });

  const bulkDelete: ResourceOptions = {
    actions: {
      deleteAll: {
        actionType: 'resource',
        icon: 'TrashCan',
        component: false,
        variant: 'danger',
        guard: 'Irreversible Delete Operation',
        handler: async (request, response, context) => {
          const { resource, h } = context
          console.log((resource as any).model)
          await AppDataSource.getRepository((resource as any).model).delete({});
          console.log(h.resourceUrl({resourceId: resource.id()}))
          return {
            notice: { message: 'All records deleted', type: 'success' },
            redirectUrl: `${h.resourceUrl({resourceId: resource.id()})}?refresh=${Date.now()}`
          };
        },
      },
    },
  };

  const adminJs = new AdminJS({
    resources: [
      {
        resource: slc_item_catalog,
        options: bulkDelete,
      },
      {
        resource: slc_tools_catalog,
        options: bulkDelete,
      },
      {
        resource: dataset_catalog,
        options: bulkDelete,
      },
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
