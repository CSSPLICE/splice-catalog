import { CreateSLCItemDTO } from '../dtos/SLCItemDTO.js';

export class MetadataExtractor {
  public static extractMetadata(item: CreateSLCItemDTO) {
    return {
      keywords: item.keywords,
      title: item.title,
      author: item.author,
    };
  }
}
