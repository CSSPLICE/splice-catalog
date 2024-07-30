import { Request, Response } from 'express';
import { AppDataSource } from '../db/data-source';
import { slc_item_catalog } from '../db/entities/SLCItemCatalog';
import { validate } from 'class-validator';
import { CreateSLCItemDTO } from '../dtos/SLCItemDTO';
import { ResponseUtil } from '../utils/Response';
import logger from '../utils/logger';

export class ReviewController {
  async validateAndReview(req: Request, res: Response, jsonArray: any[]) {
    const issues = [];
    let processedCount = 0;

    for (const item of jsonArray) {
      let dto, repo;

      switch (item.catalog_type) {
        case 'SLCItemCatalog': {
          dto = new CreateSLCItemDTO();
          Object.assign(dto, item);
          repo = AppDataSource.getRepository(slc_item_catalog);
          break;
        }
        default:
          console.log(`Unrecognized catalog type: ${item.catalog_type}`);
          continue;
      }

      if (dto && repo) {
        const validationErrors = await validate(dto);
        if (validationErrors.length > 0) {
          console.log(`Validation errors for ${item.catalog_type}:`, validationErrors);
          issues.push({
            item,
            summary: `${validationErrors.length} validation error(s) found`,
            validationErrors,
            resources: [
              { label: 'Metadata Guidelines', url: '/instructions' },
              { label: 'Common URLs Issues', url: 'https://splice.cs.vt.edu/instructions' },
              { label: 'Example Metadata', url: 'https://splice.cs.vt.edu/instructions' }
            ]
          });
          continue;
        }

        const catalogItem = repo.create(dto);
        await repo.save(catalogItem);
        processedCount++;
      }
    }

    const totalSubmissions = jsonArray.length;
    const successfulVerifications = processedCount;

    if (issues.length > 0) {
      return res.render('pages/review-dashboard', { issues, totalSubmissions, successfulVerifications, title: 'Review Dashboard' });
    }

    return ResponseUtil.sendResponse(res, `${processedCount} entries processed successfully`, 201);
  }
}
