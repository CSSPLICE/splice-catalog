export interface SLCItem {
  catalog_type: string;
  persistentID: string;
  platform_name: string;
  iframe_url: string;
  license?: string;
  description: string;
  author: string[];
  institution: string[];
  keywords: string[];
  features: string[];
  title: string;
  programming_language?: string[];
  natural_language: string[];
  protocol?: string[];
  protocol_url?: string[];
}

export interface MatchedItem {
  item: SLCItem; // Item being matched
  matchedClass?: string;
}

export interface Metadata {
  keywords: string[];
}
