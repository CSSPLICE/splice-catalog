import { validate, ValidationError } from 'class-validator';
import { CreateSLCItemDTO } from '../dtos/SLCItemDTO';

export class MetadataValidator {
  async validate(jsonArray: any[]): Promise<{ 
    issues: { item: any; validationErrors: ValidationError[] }[]; 
    validItems: CreateSLCItemDTO[]; 
    totalSubmissions: number; 
    successfulVerifications: number; 
  }> {
    const issues: { item: any; validationErrors: ValidationError[] }[] = [];
    const validItems: CreateSLCItemDTO[] = [];
    let successfulVerifications = 0;

    for (const item of jsonArray) {
      const dto = new CreateSLCItemDTO();
      Object.assign(dto, item);
      
      const validationErrors: ValidationError[] = await validate(dto);
      if (validationErrors.length > 0) {
        issues.push({ item, validationErrors });
      } else {
        validItems.push(dto);
        successfulVerifications++;
      }
    }

    return { issues, validItems, totalSubmissions: jsonArray.length, successfulVerifications };
  }
}
