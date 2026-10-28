export const MAX_SEARCH_QUERY_LENGTH = 500;

export function parseSearchQuery(value: unknown): { query: string; error?: string } {
  if (value === undefined) return { query: '' };
  if (typeof value !== 'string') return { query: '', error: 'Search query must be a string.' };
  const query = value.trim().replace(/\s+/g, ' ');
  if (query.length > MAX_SEARCH_QUERY_LENGTH) {
    return { query: '', error: `Search query must be at most ${MAX_SEARCH_QUERY_LENGTH} characters.` };
  }
  return { query };
}
