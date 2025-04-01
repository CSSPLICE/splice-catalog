import { IsNotEmpty, IsInt, IsString, IsOptional } from 'class-validator';

export class CreateValidationResultsDTO {
  @IsNotEmpty()
  @IsInt()
  slcItemId!: number;

  @IsNotEmpty()
  @IsString()
  validatedBy!: string;

  @IsOptional()
  @IsString()
  metadataIssues?: string;

  @IsOptional()
  @IsString()
  categorizationResults?: string;

  @IsOptional()
  @IsInt()
  totalSubmissions?: number;

  @IsOptional()
  @IsInt()
  successfulVerifications?: number;

  @IsOptional()
  @IsInt()
  urlsChecked?: number;

  @IsOptional()
  @IsInt()
  successfulUrls?: number;

  @IsOptional()
  @IsInt()
  unsuccessfulUrls?: number;

  @IsOptional()
  @IsString()
  validationStatus?: string;
}