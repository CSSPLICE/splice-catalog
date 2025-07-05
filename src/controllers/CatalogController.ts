import { validate } from 'class-validator';
import { Request, Response } from 'express';
import { AppDataSource } from '../db/data-source';
import { ResponseUtil } from '../utils/Response';
import { CreateSLCItemDTO } from '../dtos/SLCItemDTO';
import { slc_item_catalog } from '../db/entities/SLCItemCatalog';

export class CatalogController {
  async getCatalog(req: Request, res: Response): Promise<Response> {
    const catalog_data = await AppDataSource.getRepository(slc_item_catalog).find();
    return ResponseUtil.sendResponse(res, catalog_data, 200);
  }

  async createCatalogItem(req: Request, res: Response): Promise<Response> {
    const CatalogData = req.body;
    switch (CatalogData.catalog_type) {
      case 'SLCItemCatalog': {
        const dto = new CreateSLCItemDTO();
        Object.assign(dto, CatalogData);
        const err = await validate(dto);
        if (err.length !== 0) {
          return ResponseUtil.sendError(res, 'Invalid data', 400, err);
        }
        break;
      }
      case 'DatasetCatalog': {
        break;
      }
      default: {
        break;
      }
    }
    const repo = AppDataSource.getRepository(CatalogData.catalog_type);
    const CatalogItem = repo.create(CatalogData);
    await repo.save(CatalogItem);
    return ResponseUtil.sendResponse(res, CatalogItem, 201);
  }

  async deleteCatalogItem(req: Request, res: Response): Promise<Response> {
    const { id } = req.params;
    const CatalogData = req.body;
    switch (CatalogData.catalog_type) {
      case 'SLCItemCatalog': {
        const repo = AppDataSource.getRepository(CatalogData.catalog_type);
        const CatalogItem = await repo.findOneByOrFail({
          id: Number(id),
        });
        await repo.remove(CatalogItem);
        return ResponseUtil.sendResponse(res, 'successfully deleted the CatalogItem', 201);
      }
      case 'DatasetCatalog': {
        break;
      }
      default: {
        break;
      }
    }
    return ResponseUtil.sendResponse(res, 'failed to delete the CatalogItem', 400);
  }
  async getCatalogItemByName(req: Request, res: Response): Promise<Response> {
    const { name } = req.params;

    try {
      const item = await AppDataSource.getRepository(slc_item_catalog).findOneBy({
        exercise_name: decodeURIComponent(name),
      });

      if (!item) {
        return ResponseUtil.sendError(res, 'Item not found', 404, undefined);
      }

      return ResponseUtil.sendResponse(res, item, 200);
    } catch (error) {
      return ResponseUtil.sendError(res, 'Error retrieving item', 500, error);
    }
  }

  async dumpItem(req: Request, res: Response) {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid item ID" });
  }

  try {
    const item = await AppDataSource.getRepository(slc_item_catalog).findOne({
      where: { id },
    });

    if (!item) {
      return res.status(404).json({ error: "Item not found" });
    }

    // Create a safe filename based on the item's name
    const safeName = item.exercise_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

    const filename = `${safeName || "slc_item_" + id}.json`;

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/json");

    // Exclude the id field
    const { id: _, ...itemWithoutId } = item;
    const json = JSON.stringify(itemWithoutId, null, 2);
    res.send(json);
  } catch (error) {
    console.error("Error dumping item:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

async dumpFullCatalog(req: Request, res: Response){
  try {
    const allItems = await AppDataSource.getRepository(slc_item_catalog).find();
    
    const results = allItems.map(({ id, ...rest }) => rest);

    const jsonData = JSON.stringify(results, null, 2);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="full-catalog.json"');
    res.send(jsonData);
  } catch (error) {
    console.error("Error dumping full catalog:", error);
    res.status(500).json({ error: "Failed to dump catalog" });
  }
};
}
