import { IsNotEmpty, IsString, IsInt } from 'class-validator';

export class CreateOntologyRelationDTO {
  @IsNotEmpty()
  @IsInt()
  parent_class_id!: number;

  @IsNotEmpty()
  @IsInt()
  child_class_id!: number;

  @IsNotEmpty()
  @IsString()
  relationship_type!: string;
}
