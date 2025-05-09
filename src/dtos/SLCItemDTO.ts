import { IsNotEmpty, IsString, IsOptional, IsUrl, ValidateIf, IsArray } from 'class-validator';
import {Unique} from "typeorm";

export class CreateSLCItemDTO {
  @IsNotEmpty()
  @IsString()
  catalog_type!: string;

  @IsNotEmpty()
  @IsString()
  platform_name!: string;

  @IsNotEmpty()
  @IsUrl()
  @IsString()
  url!: string;

  // @IsNotEmpty()
  // @IsString()
  // keywords!: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  keywords?: string[];

  @IsString()
  @IsUrl()
  @ValidateIf((o) => o.lti_url !== null)
  lti_instructions_url!: string;

  @IsOptional()
  @IsNotEmpty()
  @IsString({each:true})
  @IsArray()
  exercise_type?: string[];

  // @IsNotEmpty()
  // @IsString()
  description?: string;

  @IsNotEmpty()
  @IsString({each:true})
  @IsArray()
  author!: string[];

  @IsOptional()
  // @IsNotEmpty()
  @IsString()
  institution?: string;

  @IsNotEmpty()
  @IsString()
  exercise_name!: string;

  @IsNotEmpty()
  @IsString()
  programmingLanguage!: string;

  @IsNotEmpty()
  @IsString()
  naturalLanguage!: string;

  @IsNotEmpty()
  @IsUrl()
  @IsString()
  iframe_url!: string;

  @IsOptional()
  @IsUrl()
  @IsString()
  lti_url?: string;

  @IsNotEmpty()
  @IsString()
  persistentID!: string;
}
