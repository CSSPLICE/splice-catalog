import { validate } from 'class-validator';
import { Request, Response } from 'express';
import { AppDataSource } from '../db/data-source';
import { ResponseUtil } from '../utils/Response';
import { CreateSLCToolsDTO } from '../dtos/SLCToolsDTO'; // Define this DTO as per your requirements
import { slc_tools_catalog } from '../db/entities/SLCToolsCatalog';

export class ToolsCatalogController {
    async getToolsCatalog(req: Request, res: Response): Promise<Response> {
        const toolsCatalogData = await AppDataSource.getRepository(slc_tools_catalog).find();
        return ResponseUtil.sendResponse(res, toolsCatalogData, 200);
    }

    //To Do - review the logic and ofset from upload method here
    async createToolsCatalogItem(req: Request, res: Response): Promise<Response> {
        const toolsCatalogData = req.body; 
        
        // Assign default values, might serve from a utility file soon
        toolsCatalogData.tool_description = toolsCatalogData.tool_description || 'No tool description';
        toolsCatalogData.keywords = toolsCatalogData.keywords || 'no, Keywords';
        toolsCatalogData.contact_email = toolsCatalogData.contact_email || 'default@email.com';
    
        const dto = new CreateSLCToolsDTO();
        Object.assign(dto, toolsCatalogData);
        const errors = await validate(dto);
    
        if (errors.length > 0) {
            return ResponseUtil.sendError(res, 'Invalid data', 400, errors);
        }
    
        const repo = AppDataSource.getRepository(slc_tools_catalog);
        const toolsCatalogItem = repo.create(toolsCatalogData);
        await repo.save(toolsCatalogItem);
        return ResponseUtil.sendResponse(res, toolsCatalogItem, 201);
    }
    

 
}

