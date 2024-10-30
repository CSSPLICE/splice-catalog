import { ValidationError } from "class-validator";

export interface MetadataIssue {
    item: any;
    validationErrors: ValidationError[];
  }
  
  
  export interface CategorizationResult {
    item: any;        // The exercise name 
    status: string;   // success or Failed
    matchedClass?: string; // optional, for successful matches
    error?: unknown;
  }
  
  