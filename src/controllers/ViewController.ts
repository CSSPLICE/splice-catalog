import { Request, Response } from 'express';
import { AppDataSource } from '../db/data-source';
import { Catalog } from '../db/entities/catalog';

export class ViewController {
  async homeView(req: Request, res: Response) {
    const catalog_data = await AppDataSource.getRepository(Catalog).find();
    res.render('pages/index', {
      catalog: catalog_data,
      title: 'SPLICE Catalog',
      user: req.oidc.user,
    });
  }

  profileView(req: Request, res: Response) {
    // res.render('pages/profile', { title: 'Profile', user: JSON.stringify(req.oidc.user, null, 2) });
    res.render('pages/profile', { title: 'Profile', user: req.oidc.user });
  }
}
