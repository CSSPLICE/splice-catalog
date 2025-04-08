import { IsNotEmpty, IsString, IsOptional, IsBoolean, IsInt } from 'class-validator';

export class CreateValidationResultsDTO {
  @IsNotEmpty()
  @IsString()
  user!: string;

  @IsOptional()
  @IsString()
  metadataIssues?: string;

  @IsNotEmpty()
  @IsInt()
  itemId!: number;

  @IsOptional()
  @IsBoolean()
  isUrlValid?: boolean;

  @IsOptional()
  @IsString()
  categorizationResults?: string;

  @IsOptional()
  @IsString()
  validationStatus?: string;
}
