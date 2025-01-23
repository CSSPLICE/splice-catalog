import { CreateSLCItemDTO } from '../dtos/SLCItemDTO';

export class MetadataExtractor {
  public static extractMetadata(item: CreateSLCItemDTO) {
    return {
      keywords: item.keywords, 
      exercise_name: item.exercise_name,
      author: item.author,
    };
  }
}
