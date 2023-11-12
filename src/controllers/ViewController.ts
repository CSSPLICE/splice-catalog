import { Request, Response } from 'express';
import { AppDataSource } from '../db/data-source';
import { Catalog } from '../db/entities/catalog';

export class ViewController {
  async homeView(req: Request, res: Response) {
    const catalog_data = await AppDataSource.getRepository(Catalog).find();
    res.render('pages/index', { catalog: catalog_data, title: 'SPLICE Catalog' });
  }
}
