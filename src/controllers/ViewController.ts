import { Request, Response } from 'express';
import { AppDataSource } from '../db/data-source.js';
import { slc_item_catalog } from '../db/entities/SLCItemCatalog.js';
import logger from '../utils/logger.js';
import fs from 'fs';
import { slc_tools_catalog } from '../db/entities/SLCToolsCatalog.js';
import { dataset_catalog } from '../db/entities/DatasetCatalog.js';
import { ReviewController } from './ReviewController.js';
import { ValidationResults } from '../db/entities/ValidationResults.js';

const reviewController = new ReviewController();

import { SearchController } from './SearchController.js';

const searchController = new SearchController();

export class ViewController {
  async catalogView(req: Request, res: Response) {
    return searchController.searchCatalog(req, res);
  }

  async instructionsView(req: Request, res: Response) {
    res.render('pages/instructions', {
      title: 'Instructions',
    });
  }

  async homeView(req: Request, res: Response) {
    // Fetch counts from the database
    const toolCatalogCount = await AppDataSource.getRepository(slc_tools_catalog).count();
    const slcItemCount = await AppDataSource.getRepository(slc_item_catalog).count();
    const datasetCount = await AppDataSource.getRepository(dataset_catalog).count();
    //#to do Fetch dataset count similarly

    // Render the home page with counts
    res.render('pages/index', {
      title: 'Home',
      toolCatalogCount: toolCatalogCount,
      slcItemCount: slcItemCount,
      datasetCount: datasetCount, // to be replaced with actual dataset count
    });
  }

  async uploadView(req: Request, res: Response) {
    res.render('pages/upload', {
      title: 'Upload Data',
    });
  }
  async aboutView(req: Request, res: Response) {
    res.render('pages/about', { title: 'About' });
  }

  async toolView(req: Request, res: Response) {
    // Fetch SLC tools catalog data
    const toolsCatalog_data = await AppDataSource.getRepository(slc_tools_catalog).find();
    res.render('pages/toolcatalog', {
      toolsCatalog: toolsCatalog_data,
      title: 'Tools Catalog',
    });
  }

  async datasetCatalogView(req: Request, res: Response) {
    try {
      const datasetCatalog_data = await AppDataSource.getRepository(dataset_catalog).find();
      res.render('pages/datasetcatalog', {
        datasets: datasetCatalog_data,
        title: 'Dataset Catalog',
      });
    } catch (error) {
      logger.error('Failed to fetch dataset catalog data:', error);
      res.status(500).send('Internal Server Error');
    }
  }

  async uploadPost(req: Request, res: Response) {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
      const absolutePath = req.file.path;
      const jsonString = fs.readFileSync(absolutePath, 'utf-8');
      req.body = JSON.parse(jsonString);

      await reviewController.validateAndReview(req, res);
    } catch (error) {
      logger.error('Error processing upload:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
  profileView(req: Request, res: Response) {
    // res.render('pages/profile', { title: 'Profile', user: JSON.stringify(req.oidc.user, null, 2) });
    res.render('pages/profile', { title: 'Profile' });
  }

  async rejectAll(req: Request, res: Response) {
    return res.redirect('/upload');
  }

  /* async itemViewByName(req: Request, res: Response) {
    const { name } = req.params;

    try {
      const item = await AppDataSource.getRepository(slc_item_catalog).findOneBy({
        exercise_name: decodeURIComponent(name),
      });

      if (!item) {
        return res.status(404).render('pages/notfound', { title: 'Item Not Found' });
      }

      res.render('pages/item', { item, title: 'Item View' });
    } catch (error) {
      return res.status(500).send('Internal Server Error');
    }
  }*/
}
export async function downloadValidationResults(req: Request, res: Response) {
  try {
    const repo = AppDataSource.getRepository(ValidationResults);
    const results = await repo.find({ relations: ['item'] });

    res.setHeader('Content-Disposition', 'attachment; filename="validation_results.json"');
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(results, null, 2));
  } catch (error) {
    console.error('Error downloading validation results:', error);
    res.status(500).send('Failed to download results');
  }
}
