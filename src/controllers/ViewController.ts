import { Request, Response } from 'express';
import { AppDataSource } from '../db/data-source';
import { slc_item_catalog } from '../db/entities/SLCItemCatalog';
import logger from '../utils/logger';
import fs from 'fs';
import { CreateSLCItemDTO } from '../dtos/SLCItemDTO';
import { validate } from 'class-validator';
import { ResponseUtil } from '../utils/Response';
import { ILike } from 'typeorm';
import { ToolsCatalogController } from './ToolsCatalogController';
import { CreateSLCToolsDTO } from 'src/dtos/SLCToolsDTO';
import { slc_tools_catalog } from 'src/db/entities/SLCToolsCatalog';

export class ViewController {
  async catalogView(req: Request, res: Response) {
    const catalog_data = await AppDataSource.getRepository(slc_item_catalog).find();

    // Fetch SLC tools catalog data
    const toolsCatalog_data = await AppDataSource.getRepository(slc_tools_catalog).find();
    res.render('pages/catalog', { catalog: catalog_data, toolsCatalog: toolsCatalog_data, title: 'SPLICE Catalog' });
  }

  async itemView(req: Request, res: Response) {
    const query = req.body.item_link;
    const item = await AppDataSource.getRepository(slc_item_catalog).findOne({
      where: [{ exercise_name: ILike(`%${query}%`) }],
    });
    res.render('pages/item', { item: item, title: 'Item View' });
  }

  async instructionsView(req: Request, res: Response) {
    res.render('pages/instructions', { title: 'Instructions' });
  }

  async homeView(req: Request, res: Response) {
     // Fetch counts from the database
     const toolCatalogCount = await AppDataSource.getRepository(slc_tools_catalog).count();
     const slcItemCount = await AppDataSource.getRepository(slc_item_catalog).count();
     //#to do Fetch dataset count similarly

     // Render the home page with counts
     res.render('pages/index', {
         title: 'Home',
         toolCatalogCount: toolCatalogCount,
         slcItemCount: slcItemCount,
         datasetCount: 0, // to be replaced with actual dataset count
     });
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
    const jsonArray = JSON.parse(jsonString);
  
    let processedCount = 0;
    let slcToolsProcessed = false;
  
    for (const item of jsonArray) {
      let dto, repo;
      // Log the presence and value of lti_url for the current item
      logger.info(`Processing item with platform_name: ${item.platform_name}, lti_url: ${item.lti_url}`);

      switch (item.catalog_type) {
        case 'SLCItemCatalog':
          dto = new CreateSLCItemDTO();
          Object.assign(dto, item); // Assuming the structure matches, adjust as needed
          repo = AppDataSource.getRepository(slc_item_catalog);
  
          // Check for lti_url presence and only process the first SLC Tools Catalog entry
          if (item.lti_url && !slcToolsProcessed) {
            logger.info(`Processing SLC Tools Catalog entry for platform: ${item.platform_name} with lti_url: ${item.lti_url}`);
  
            const existingEntry = await AppDataSource.getRepository(slc_tools_catalog)
              .findOneBy({ platform_name: item.platform_name });
  
            if (!existingEntry) {
              const toolsDto = new CreateSLCToolsDTO();
              Object.assign(toolsDto, {
                platform_name: item.platform_name,
                url: item.url,
                tool_description: item.description || 'No description provided',
                license: item.license || 'License not specified',
                standard_support: 'LTI', // Directly setting 'LTI' if lti_url is present
                keywords: item.keywords,
                contact_email: item.contact_email || 'DefaultEmail@example.com',
              });
              const toolsRepo = AppDataSource.getRepository(slc_tools_catalog);
              const toolsCatalogItem = toolsRepo.create(toolsDto);
              // Log the standardSupport value before saving
              logger.info(`standardSupport value before saving: ${toolsCatalogItem.standard_support}`);
              await toolsRepo.save(toolsCatalogItem);
              slcToolsProcessed = true; //only one entry is processed for SLCToolsCatalog
            }
          }
          break;
        case 'DatasetCatalog':
          //  DatasetCatalog entry creation logic 
          break;       
      }
  
      // Common validation and saving logic for the catalog types
      if (dto && repo) {
        const validationErrors = await validate(dto);
        if (validationErrors.length > 0) {
          console.error(`Validation errors for ${item.catalog_type}:`, validationErrors);
        } else {
          const catalogItem = repo.create(dto);
          await repo.save(catalogItem);
          processedCount++;
        }
      }
    }
  
    return ResponseUtil.sendResponse(res, `${processedCount} entries processed successfully`, 201);
  }
  
}
