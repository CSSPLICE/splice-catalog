export interface SLCItem {
  catalog_type: string;
  platform_name: string;
  url: string;
  keywords?: string[];
  lti_instructions_url?: string;
  exercise_type?: string[];
  description?: string;
  author: string[];
  institution?: string;
  exercise_name: string;
  natural_language: string;
  programming_language: string;
  iframe_url: string;
  lti_url?: string;
  persistent_id: string;
}

export interface MatchedItem {
  item: SLCItem; // Item being matched
  matchedClass?: string;
}

export interface Metadata {
  keywords: string[];
}
