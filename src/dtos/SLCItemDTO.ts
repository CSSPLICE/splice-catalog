import { IsNotEmpty, IsString } from 'class-validator';

export class CreateSLCItemDTO {
  @IsNotEmpty()
  @IsString()
  platform_name!: string;

  @IsNotEmpty()
  @IsString()
  url!: string;

  @IsNotEmpty()
  @IsString()
  keywords!: string;

  @IsString()
  lti_instructions_url!: string;

  @IsString()
  exercise_type!: string;

  @IsString()
  description!: string;

  @IsString()
  author!: string;

  @IsString()
  institution!: string;

  @IsString()
  exercise_name!: string;

  @IsString()
  iframe_url!: string;

  @IsString()
  lti_url!: string;
}
