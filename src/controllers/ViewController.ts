import { Request, Response } from 'express';
import { AppDataSource } from '../db/data-source';
import { slc_item_catalog } from '../db/entities/SLCItemCatalog';
import logger from '../utils/logger';
import path from 'path';
import fs from 'fs';
import { CreateSLCItemDTO } from '../dtos/SLCItemDTO';
import { validate } from 'class-validator';
import { ResponseUtil } from '../utils/Response';

export class ViewController {
  async homeView(req: Request, res: Response) {
    const catalog_data = await AppDataSource.getRepository(slc_item_catalog).find();
    res.render('pages/index', { catalog: catalog_data, title: 'SPLICE Catalog' });
  }

  async uploadView(req: Request, res: Response) {
    res.render('pages/upload', { title: 'Upload Data' });
  }

  async uploadPost(req: Request, res: Response) {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const absolutePath = req.file.path;
    const jsonString = fs.readFileSync(absolutePath, 'utf-8');
    const jsonObject = JSON.parse(jsonString);
    let count = 0;
    let total = 0;

    for (const item in jsonObject) {
      switch (jsonObject[item].catalog_type) {
        case 'SLCItemCatalog': {
          const dto = new CreateSLCItemDTO();
          Object.assign(dto, jsonObject[item]);
          const err = await validate(dto);
          total += 1;
          if (err.length !== 0) {
            count += 1;
            continue;
            // return ResponseUtil.sendError(res, 'Invalid data', 400, err);
          } else {
            const repo = AppDataSource.getRepository(slc_item_catalog);
            logger.info('item');
            const CatalogItem = repo.create(jsonObject[item]);
            logger.info('save');
            await repo.save(CatalogItem);
          }
          break;
        }
        case 'DatasetCatalog': {
          break;
        }
        default: {
          return ResponseUtil.sendResponse(res, req.file, 400);
        }
      }
    }
    // check if success at end
    logger.info('count: ' + count);
    logger.info('total: ' + total);
    return ResponseUtil.sendResponse(res, req.file, 201);
  }
}
