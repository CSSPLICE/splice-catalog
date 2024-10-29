import { IsNotEmpty, IsString, IsBoolean, IsInt, IsOptional } from 'class-validator';

export class CreateOntologyAliasDTO {
  @IsNotEmpty()
  @IsInt()
  class_id!: number;

  @IsNotEmpty()
  @IsString()
  alias!: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean = true;
}
