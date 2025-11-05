// src/dtos/DatasetCatalogDTO.ts
import { IsOptional, IsString, IsUrl, IsInt, IsArray, ValidateNested, IsNumber, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

class ContributorDTO {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  givenName?: string;

  @IsOptional()
  @IsString()
  familyName?: string;

  @IsOptional()
  @IsString()
  identifier?: string;

  @IsOptional()
  @IsString()
  affiliation?: string;
}

export class CreateDatasetCatalogDTO {
  // Text fields
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  platform?: string;

  @IsOptional()
  @IsString()
  datasetName?: string;

  @IsOptional()
  @IsString()
  description?: string;

  // Arrays of strings
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dataFormats?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dataType?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  // JSON array of objects
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContributorDTO)
  contributors?: ContributorDTO[];

  // Optional metadata
  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsInt()
  publicationYear?: number;

  @IsOptional()
  @IsString()
  publisher?: string;

  @IsOptional()
  @IsUrl()
  resourceUrl?: string;

  @IsOptional()
  @IsString()
  resourceUrlType?: string;

  @IsOptional()
  @IsString()
  bibtexSource?: string;

  @IsOptional()
  @IsString()
  rights?: string;

  @IsOptional()
  @IsString()
  availability?: string;

  @IsOptional()
  @IsNumber()
  fairnessScore?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  programmingLanguages?: string[];

  // Dates
  @IsOptional()
  @IsDateString()
  dataCollectionStartDate?: string;

  @IsOptional()
  @IsDateString()
  dataCollectionEndDate?: string;

  // Numeric counts
  @IsOptional()
  @IsInt()
  taskNumber?: number;

  @IsOptional()
  @IsInt()
  sampleSize?: number;

  // Free-text long fields
  @IsOptional()
  @IsString()
  sampleDemographics?: string;

  // Country list
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  country?: string[];

  @IsOptional()
  @IsString()
  educationalInstitution?: string;

  @IsOptional()
  @IsString()
  dataStandard?: string;

  @IsOptional()
  @IsString()
  learningEnvironment?: string;

  @IsOptional()
  @IsString()
  aggregation?: string;

  @IsOptional()
  @IsString()
  aggregationLevel?: string;

  @IsOptional()
  @IsUrl()
  relatedPublicationUrl?: string;

  @IsOptional()
  @IsString()
  relatedPublication?: string;

  @IsOptional()
  @IsString()
  researchQuestion?: string;

  @IsOptional()
  @IsString()
  futureWork?: string;
}
