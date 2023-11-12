import { IsNotEmpty, IsString, IsOptional, IsUrl } from 'class-validator';

export class CreateSLCItemDTO {
  @IsNotEmpty()
  @IsString()
  platform_name!: string;

  @IsNotEmpty()
  @IsUrl()
  @IsString()
  url!: string;

  @IsNotEmpty()
  @IsString()
  keywords!: string;

  @IsOptional()
  @IsString()
  lti_instructions_url!: string;

  @IsOptional()
  @IsString()
  exercise_type!: string;

  @IsOptional()
  @IsString()
  description!: string;

  @IsOptional()
  @IsString()
  author!: string;

  @IsOptional()
  @IsString()
  institution!: string;

  @IsOptional()
  @IsString()
  exercise_name!: string;

  @IsOptional()
  @IsUrl()
  @IsString()
  iframe_url!: string;

  @IsOptional()
  @IsUrl()
  @IsString()
  lti_url!: string;
}
