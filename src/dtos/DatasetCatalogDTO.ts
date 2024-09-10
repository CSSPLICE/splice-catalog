// src/dtos/DatasetCatalogDTO.ts
import { IsNotEmpty, IsString, IsOptional, IsUrl, IsInt, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class ContributorDTO {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  affiliation!: string;
}

export class CreateDatasetCatalogDTO {
  @IsNotEmpty()
  @IsString()
  title!: string;

  @IsNotEmpty()
  @IsString()
  platform!: string;

  @IsNotEmpty()
  @IsString()
  datasetName!: string;

  @IsNotEmpty()
  @IsUrl()
  url!: string;

  @IsString()
  description!: string;

  @IsArray()
  @IsString({ each: true })
  dataFormats!: string[];

  @IsArray()
  @IsString({ each: true })
  dataType!: string[];

  @IsArray()
  @IsString({ each: true })
  keywords!: string[];

  @IsString()
  @IsOptional()
  population?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContributorDTO)
  contributors!: ContributorDTO[];

  @IsString()
  @IsOptional()
  language?: string;

  @IsInt()
  publicationYear!: number;
}
