import { ValidationError } from 'class-validator';
import { SLCItem } from './ItemTypes.js'; // Use SLCItem as the primary item type

export interface MetadataIssue {
  item: SLCItem;
  validationErrors: ValidationError[];
}

export interface CategorizationResult {
  item: string; //`exercise_name` of the item
  status: 'success' | 'failed' | 'Matched' | 'Unclassified' | 'Unmatched';
  matchedClass?: string;
  error?: string | Error;
}

export interface ValidationIssue {
  item: SLCItem;
  validationErrors: ValidationError[];
}

export interface URLValidationItem extends SLCItem {
  iframe_url: string;
}

export interface URLValidationIssue {
  item: URLValidationItem;
  error: string;
}

export interface URLValidationResult {
  urlsChecked: number;
  successfulUrls: number;
  unsuccessfulUrls: number;
  issues: { item: URLValidationItem; error: string }[];
}
