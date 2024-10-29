import { IsNotEmpty, IsString, IsBoolean, IsOptional } from 'class-validator';

export class CreateOntologyClassDTO {
  @IsNotEmpty()
  @IsString()
  class_uri!: string;

  @IsNotEmpty()
  @IsString()
  label!: string;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean = true;
}
