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
  interface!: string;

  @IsString()
  @IsOptional()
  keywords!: string;

  @IsEmail()
  @IsOptional()
  contact_email!: string;
}
