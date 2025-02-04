import { validate, ValidationError } from 'class-validator';
import { CreateSLCItemDTO } from '../dtos/SLCItemDTO';
import { ValidationIssue } from '../types/ValidationTypes';

export class MetadataValidator {
  async validate(jsonArray: CreateSLCItemDTO[]): Promise<{
    issues: ValidationIssue[];
    validItems: CreateSLCItemDTO[];
    totalSubmissions: number;
    successfulVerifications: number;
  }> {
    const issues: ValidationIssue[] = [];
    const validItems: CreateSLCItemDTO[] = [];
    let successfulVerifications = 0;

    for (const rawItem of jsonArray) {
      const dto = new CreateSLCItemDTO();
      Object.assign(dto, rawItem);

      const validationErrors: ValidationError[] = await validate(dto);
      if (validationErrors.length > 0) {
        issues.push({ item: dto, validationErrors });
      } else {
        validItems.push(dto);
        successfulVerifications++;
      }
    }

    return { issues, validItems, totalSubmissions: jsonArray.length, successfulVerifications };
  }
}
