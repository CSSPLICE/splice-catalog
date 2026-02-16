import { IsNotEmpty, IsString, IsNumber, IsOptional } from 'class-validator';

export class SearchAliasDTO {
  @IsNotEmpty()
  @IsString()
  term!: string;

  @IsNotEmpty()
  @IsString()
  synonym!: string;

  @IsOptional()
  @IsNumber()
  is_active?: number = 1;
}
