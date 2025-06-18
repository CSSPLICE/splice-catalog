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
  @IsOptional()
  lti_key!: string;

  @IsString()
  @IsOptional()
  lti_secret!: string;

  @IsUrl()
  @IsString()
  @IsOptional()
  lti_config_url!: string;

}
