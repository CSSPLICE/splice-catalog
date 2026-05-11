import { slc_item_catalog } from '../db/entities/SLCItemCatalog.js';
import { slc_tools_catalog } from '../db/entities/SLCToolsCatalog.js';
import { dataset_catalog } from '../db/entities/DatasetCatalog.js';
import { OntologyClasses } from '../db/entities/OntologyClass.js';
import { OntologyRelations } from '../db/entities/OntologyRelation.js';
import { OntologyAliases } from '../db/entities/OntologyAlias.js';
import { ItemClassification } from '../db/entities/ItemClassification.js';
import { SearchAlias } from '../db/entities/SearchAlias.js';
import { ValidationJob } from '../db/entities/ValidationJob.js';
import { ValidationJobConstraint } from '../db/entities/ValidationJobConstraint.js';
import { AdminJS, ResourceOptions, ActionRequest, ActionResponse } from 'adminjs';
import { Database, Resource } from '@adminjs/typeorm';
import { AppDataSource } from '../db/data-source.js';
import AdminJSExpress from '@adminjs/express';
const { buildRouter } = AdminJSExpress;

function buildOrigin(request: ActionRequest): string {
  const headers = (request as unknown as { headers?: Record<string, string | string[] | undefined> }).headers || {};
  const protoHeader = headers['x-forwarded-proto'];
  const proto = (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader) || 'http';
  const hostHeader = headers['x-forwarded-host'] || headers['host'];
  const host = (Array.isArray(hostHeader) ? hostHeader[0] : hostHeader) || 'localhost';
  return `${proto}://${host}`;
}

export function setup() {
  AdminJS.registerAdapter({
    Database,
    Resource,
  });

  const customOptions: ResourceOptions = {
    actions: {
      list: {
        before: async (request) => {
          if (request.query && !request.query.perPage) {
            request.query.perPage = 100;
          }
          return request;
        },
      },
      deleteAll: {
        actionType: 'resource',
        icon: 'TrashCan',
        component: false,
        variant: 'danger',
        guard: 'Irreversible Delete Operation',
        handler: async (request, response, context) => {
          const { resource, h } = context;
          console.log((resource as any).model);
          await AppDataSource.getRepository((resource as any).model).delete({});
          console.log(h.resourceUrl({ resourceId: resource.id() }));
          return {
            notice: { message: 'All records deleted', type: 'success' },
            redirectUrl: `${h.resourceUrl({ resourceId: resource.id() })}?refresh=${Date.now()}`,
          };
        },
      },
    },
  };

  const adminJs = new AdminJS({
    resources: [
      {
        resource: slc_item_catalog,
        options: customOptions,
      },
      {
        resource: slc_tools_catalog,
        options: customOptions,
      },
      {
        resource: dataset_catalog,
        options: customOptions,
      },
      { resource: OntologyClasses },
      { resource: OntologyRelations },
      { resource: OntologyAliases },
      { resource: ItemClassification },
      { resource: SearchAlias },
      {
        resource: ValidationJob,
        options: {
          listProperties: [
            'id',
            'submitted_at',
            'status',
            'catalog_type',
            'total',
            'processed',
            'saved',
            'updated',
            'url',
          ],
          showProperties: [
            'id',
            'url',
            'submitted_at',
            'status',
            'catalog_type',
            'total',
            'processed',
            'saved',
            'updated',
          ],
          properties: {
            url: {
              type: 'string',
              isVirtual: true,
              isVisible: { list: true, show: true, edit: false, filter: false },
            },
          },
          actions: {
            new: { isAccessible: false },
            edit: { isAccessible: false },
            list: {
              after: async (response: ActionResponse, request: ActionRequest) => {
                const origin = buildOrigin(request);
                response.records = (response.records || []).map((rec: { params: Record<string, unknown> }) => {
                  rec.params.url = `${origin}/review/${rec.params.id}`;
                  return rec;
                });
                return response;
              },
            },
            show: {
              after: async (response: ActionResponse, request: ActionRequest) => {
                const origin = buildOrigin(request);
                if (response.record) {
                  response.record.params.url = `${origin}/review/${response.record.params.id}`;
                }
                return response;
              },
            },
          },
        },
      },
      {
        resource: ValidationJobConstraint,
        options: {
          actions: {
            new: { isAccessible: false },
            edit: { isAccessible: false },
          },
        },
      },
    ],
    rootPath: '/admin',
  });

  return buildRouter(adminJs);
}
