import { Request, Response } from 'express';
import logger from '../utils/logger.js';
import { AppDataSource } from '../db/data-source.js'; // Adjust the path to your data-source file
import { slc_item_catalog } from '../db/entities/SLCItemCatalog.js';
import { slc_tools_catalog } from '../db/entities/SLCToolsCatalog.js';
import { dataset_catalog } from '../db/entities/DatasetCatalog.js';
import { validate, ValidationError } from 'class-validator';

type Severity = 'error' | 'warning' | 'notice';
type RichConstraint = { message: string; severity: Severity };
type RichError = {
  persistentID: string;
  property: string;
  constraints: Record<string, RichConstraint>;
};

function hasPersistentID(obj: object): obj is { persistentID: string } {
  return Object.prototype.hasOwnProperty.call(obj, 'persistentID');
}

function hasSeverity(result: ValidationError[], severity: Severity): boolean {
  return result.some((validationError) => {
    const constraints = validationError.constraints || {};
    const contexts = validationError.contexts || {};
    return Object.keys(constraints).some(
      (constraintName) => contexts[constraintName]?.severity === severity,
    );
  });
}

function hasConstraint(result: ValidationError[], name: string): boolean {
  return result.some((e) => !!e.constraints && name in e.constraints);
}

function richifyError(error: ValidationError): RichError {
  let persistentID = 'missing id';
  if (error.target && typeof error.target === 'object' && hasPersistentID(error.target)) {
    persistentID = error.target.persistentID;
  }
  const richConstraints: Record<string, RichConstraint> = {};
  if (error.constraints) {
    for (const [key, message] of Object.entries(error.constraints)) {
      const context = error.contexts ? error.contexts[key] : undefined;
      richConstraints[key] = { message, severity: (context?.severity as Severity) || 'error' };
    }
  }
  return { persistentID, property: error.property, constraints: richConstraints };
}

function renderTemplate(
  req: Request,
  res: Response,
  view: string,
  locals: object,
): Promise<string> {
  return new Promise((resolve, reject) => {
    req.app.render(
      view,
      { ...req.app.locals, ...res.locals, ...locals },
      (err, html) => (err ? reject(err) : resolve(html)),
    );
  });
}

export class ReviewController {
  async validateAndReview(req: Request, res: Response) {
    const jsonArray = Array.isArray(req.body) ? req.body : [req.body];
    const itemsRepository = AppDataSource.getRepository(slc_item_catalog);
    const toolsRepository = AppDataSource.getRepository(slc_tools_catalog);
    const datasetRepository = AppDataSource.getRepository(dataset_catalog);

    let initialHtml: string;
    try {
      initialHtml = await renderTemplate(req, res, 'pages/review', {
        title: 'Review Dashboard',
        saved: 0,
        updated: 0,
        errors: [],
      });
    } catch (error) {
      logger.error('Failed to render review template:', error);
      if (!res.headersSent) res.status(500).send('Error during validation');
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.write(initialHtml);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (res as any).flush === 'function') (res as any).flush();

    let clientConnected = true;
    req.on('close', () => {
      clientConnected = false;
      logger.info('Client disconnected; validation continues server-side');
    });

    const safeWrite = (chunk: string) => {
      if (!clientConnected) return;
      try {
        res.write(chunk);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (typeof (res as any).flush === 'function') (res as any).flush();
      } catch (err) {
        clientConnected = false;
        logger.warn('Lost client during stream:', err);
      }
    };

    const emit = (payload: object) => {
      const json = JSON.stringify(payload).replace(/</g, '\\u003c');
      safeWrite(`<script>window.__reviewUpdate(${json})</script>\n`);
    };

    try {
      logger.info('Starting metadata validation');

      const slcItemCatalogs = jsonArray.filter((item) => item.catalog_type === 'SLCItem');
      const slcToolsCatalogs = jsonArray.filter((item) => item.catalog_type === 'SLCToolsCatalog');
      const datasetCatalogs = jsonArray.filter((item) => item.catalog_type === 'DatasetCatalog');

      const total = slcItemCatalogs.length + slcToolsCatalogs.length + datasetCatalogs.length;
      let saved = 0;
      let updated = 0;
      let processed = 0;

      emit({ total, processed, saved, updated });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const processGroup = async (repo: any, items: unknown[], label: string) => {
        if (items.length === 0) return;
        logger.info(`Processing ${items.length} ${label} items`);
        for (const item of items) {
          const entity = repo.create(item);
          const result = await validate(entity);
          const newErrors = result.map(richifyError);
          if (!hasSeverity(result, 'error')) {
            await repo.save(entity);
            if (hasConstraint(result, 'duplicate')) {
              updated++;
            } else {
              saved++;
            }
          }
          processed++;
          emit({ processed, saved, updated, total, newErrors });
        }
      };

      await processGroup(itemsRepository, slcItemCatalogs, 'SLCItemCatalog');
      await processGroup(toolsRepository, slcToolsCatalogs, 'SLCToolsCatalog');
      await processGroup(datasetRepository, datasetCatalogs, 'DatasetCatalog');

      safeWrite('<script>window.__reviewDone()</script>\n');
      if (clientConnected) res.end();
      logger.info(`Validation complete: ${processed}/${total} processed, ${saved} saved, ${updated} updated`);
    } catch (error) {
      logger.error('Error during validation:', error);
      console.log(error);
      safeWrite('<script>(function(){var i=document.getElementById("status-indicator");if(i){i.className="";i.style.color="red";i.textContent="✗";i.setAttribute("aria-label","Error during validation");}})();</script>\n');
      if (clientConnected) res.end();
    }
  }
}