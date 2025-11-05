import { IsNotEmpty, IsString, IsOptional, IsUrl, IsArray } from 'class-validator';

export class CreateSLCItemDTO {
  @IsNotEmpty()
  @IsString()
  catalog_type!: string;

  @IsNotEmpty()
  @IsString()
  persistentID!: string;

  @IsNotEmpty()
  @IsString()
  platform_name!: string;

  @IsNotEmpty()
  @IsUrl()
  @IsString()
  iframe_url!: string;

  @IsOptional()
  @IsString()
  license?: string;

  @IsNotEmpty()
  @IsString()
  description!: string;

  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  author!: string[];

  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  institution!: string[];

  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  keywords!: string[];

  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  features!: string[];

  @IsNotEmpty()
  @IsString()
  title!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  programming_language?: string[];

  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  natural_language!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  protocol?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  protocol_url?: string[];
}
