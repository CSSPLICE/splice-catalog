import { IsNotEmpty, IsInt } from 'class-validator';

export class CreateItemClassificationDTO {
  @IsNotEmpty()
  @IsInt()
  item_id!: number;

  @IsNotEmpty()
  @IsInt()
  class_id!: number;
}
