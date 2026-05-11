import { Request, Response } from 'express';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import logger from '../utils/logger.js';
import { AppDataSource } from '../db/data-source.js';
import { slc_item_catalog } from '../db/entities/SLCItemCatalog.js';
import { slc_tools_catalog } from '../db/entities/SLCToolsCatalog.js';
import { dataset_catalog } from '../db/entities/DatasetCatalog.js';
import { ValidationJob } from '../db/entities/ValidationJob.js';
import { ValidationJobConstraint } from '../db/entities/ValidationJobConstraint.js';
import { validate, ValidationError } from 'class-validator';

type Severity = 'error' | 'warning' | 'notice';
type RichConstraint = { message: string; severity: Severity };
type RichError = {
  persistentID: string;
  property: string;
  constraints: Record<string, RichConstraint>;
};

type JobState = {
  job: ValidationJob;
  errors: RichError[];
  emitter: EventEmitter;
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

export class ReviewController {
  private jobs = new Map<string, JobState>();

  startJob = (jsonArray: unknown[]): string => {
    const uuid = randomUUID();
    const job = new ValidationJob();
    job.id = uuid;
    job.submitted_at = new Date();
    job.total = 0;
    job.saved = 0;
    job.updated = 0;
    job.processed = 0;
    job.status = 'processing';

    const types = new Set(
      jsonArray
        .map((item) =>
          item && typeof item === 'object'
            ? ((item as Record<string, unknown>).catalog_type as string | undefined)
            : undefined,
        )
        .filter((t): t is string => typeof t === 'string'),
    );
    if (types.size === 1) {
      job.catalog_type = [...types][0] as ValidationJob['catalog_type'];
    }

    const state: JobState = { job, errors: [], emitter: new EventEmitter() };
    state.emitter.setMaxListeners(0);
    this.jobs.set(uuid, state);

    void this.runJob(uuid, jsonArray);
    return uuid;
  };

  private runJob = async (uuid: string, jsonArray: unknown[]) => {
    const state = this.jobs.get(uuid);
    if (!state) return;
    const { job, emitter } = state;

    try {
      logger.info(`[review:${uuid}] starting validation`);

      const itemsRepository = AppDataSource.getRepository(slc_item_catalog);
      const toolsRepository = AppDataSource.getRepository(slc_tools_catalog);
      const datasetRepository = AppDataSource.getRepository(dataset_catalog);

      const slcItemCatalogs = jsonArray.filter(
        (item): item is Record<string, unknown> =>
          !!item && (item as Record<string, unknown>).catalog_type === 'SLCItem',
      );
      const slcToolsCatalogs = jsonArray.filter(
        (item): item is Record<string, unknown> =>
          !!item && (item as Record<string, unknown>).catalog_type === 'SLCToolsCatalog',
      );
      const datasetCatalogs = jsonArray.filter(
        (item): item is Record<string, unknown> =>
          !!item && (item as Record<string, unknown>).catalog_type === 'DatasetCatalog',
      );

      job.total = slcItemCatalogs.length + slcToolsCatalogs.length + datasetCatalogs.length;
      emitter.emit('update', { type: 'init', total: job.total });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const processGroup = async (repo: any, items: unknown[], label: string) => {
        if (items.length === 0) return;
        logger.info(`[review:${uuid}] processing ${items.length} ${label}`);
        for (const item of items) {
          const entity = repo.create(item);
          const result = await validate(entity);
          const newErrors = result.map(richifyError);
          if (!hasSeverity(result, 'error')) {
            await repo.save(entity);
            if (hasConstraint(result, 'duplicate')) {
              job.updated++;
            } else {
              job.saved++;
            }
          }
          job.processed++;
          if (newErrors.length) state.errors.push(...newErrors);
          emitter.emit('update', {
            type: 'progress',
            processed: job.processed,
            saved: job.saved,
            updated: job.updated,
            total: job.total,
            newErrors,
          });
        }
      };

      await processGroup(itemsRepository, slcItemCatalogs, 'SLCItemCatalog');
      await processGroup(toolsRepository, slcToolsCatalogs, 'SLCToolsCatalog');
      await processGroup(datasetRepository, datasetCatalogs, 'DatasetCatalog');

      job.status = 'complete';
      logger.info(
        `[review:${uuid}] complete: ${job.processed}/${job.total} processed, ${job.saved} saved, ${job.updated} updated`,
      );
    } catch (error) {
      job.status = 'failed';
      logger.error(`[review:${uuid}] failed:`, error);
    } finally {
      try {
        await this.persistJob(state);
      } catch (persistErr) {
        logger.error(`[review:${uuid}] failed to persist job:`, persistErr);
      }
      emitter.emit('terminal', { status: job.status });
      this.jobs.delete(uuid);
    }
  };

  private persistJob = async (state: JobState) => {
    const constraints = state.errors.map((e) => {
      const c = new ValidationJobConstraint();
      c.persistentID = e.persistentID;
      c.property = e.property;
      c.constraints = e.constraints;
      c.job_id = state.job.id;
      return c;
    });
    state.job.constraints = constraints;
    await AppDataSource.getRepository(ValidationJob).save(state.job);
  };

  getReview = async (req: Request, res: Response) => {
    const { uuid } = req.params;
    const state = this.jobs.get(uuid);
    if (state) {
      return res.render('pages/review', {
        title: 'Review Dashboard',
        uuid,
        status: state.job.status,
        total: state.job.total,
        processed: state.job.processed,
        saved: state.job.saved,
        updated: state.job.updated,
        errors: state.errors,
        live: true,
      });
    }

    const persisted = await AppDataSource.getRepository(ValidationJob).findOne({
      where: { id: uuid },
      relations: { constraints: true },
    });
    if (!persisted) {
      return res.status(404).send(`Validation job ${uuid} not found`);
    }

    const errors: RichError[] = (persisted.constraints || []).map((c) => ({
      persistentID: c.persistentID,
      property: c.property,
      constraints: c.constraints,
    }));

    return res.render('pages/review', {
      title: 'Review Dashboard',
      uuid,
      status: persisted.status,
      total: persisted.total,
      processed: persisted.processed,
      saved: persisted.saved,
      updated: persisted.updated,
      errors,
      live: false,
    });
  };

  streamReview = (req: Request, res: Response) => {
    const { uuid } = req.params;
    const state = this.jobs.get(uuid);

    if (!state) {
      res.status(204).end();
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    send('snapshot', {
      status: state.job.status,
      total: state.job.total,
      processed: state.job.processed,
      saved: state.job.saved,
      updated: state.job.updated,
    });

    const onUpdate = (payload: unknown) => send('update', payload);
    const onTerminal = (payload: unknown) => {
      send('terminal', payload);
      cleanup();
      res.end();
    };

    const cleanup = () => {
      state.emitter.off('update', onUpdate);
      state.emitter.off('terminal', onTerminal);
    };

    state.emitter.on('update', onUpdate);
    state.emitter.on('terminal', onTerminal);

    req.on('close', cleanup);
  };
}

export const reviewController = new ReviewController();