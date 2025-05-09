import { IsNotEmpty, IsString, IsEmail, IsOptional, IsUrl } from 'class-validator';

export class CreateSLCToolsDTO {
  @IsNotEmpty()
  @IsString()
  platform_name!: string;

  @IsNotEmpty()
  @IsUrl()
  @IsString()
  url!: string;

  @IsString()
  @IsOptional()
  tool_description!: string;

  @IsString()
  @IsOptional()
  license!: string;

  @IsString()
  @IsOptional()
  standard_support!: string;

  @IsString()
  @IsOptional()
  keywords!: string;

  @IsEmail()
  @IsOptional()
  contact_email!: string;

  @IsString()
  lti_key!: string;

  @IsString()
  lti_secret!: string;

  @IsString()
  @IsUrl()
  lti_config_url!: string;
}
