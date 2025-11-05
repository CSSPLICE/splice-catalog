import { CreateSLCItemDTO } from '../dtos/SLCItemDTO.js';
import { MatchedItem } from './ItemTypes.js';

export interface CategorizedItem {
  item: CreateSLCItemDTO;
  matchedClass: string;
}

export interface CategorizationReport {
  matched: MatchedItem[];
  unclassified: MatchedItem[];
  unmatched: MatchedItem[];
}
