import { CreateSLCItemDTO } from '../dtos/SLCItemDTO';
import { MatchedItem } from './ItemTypes';

export interface CategorizedItem {
  item: CreateSLCItemDTO;
  matchedClass: string;
}

export interface CategorizationReport {
  matched: MatchedItem[];
  unclassified: MatchedItem[];
  unmatched: MatchedItem[];
}
