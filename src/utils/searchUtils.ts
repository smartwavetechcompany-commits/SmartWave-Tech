/**
 * Simple fuzzy search utility
 * @param text The text to search in
 * @param query The search query
 * @returns boolean indicating if the query matches the text fuzzily
 */
export function fuzzySearch(text: string, query: string): boolean {
  if (!query) return true;
  if (!text) return false;
  
  const normalizedText = text.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  
  if (normalizedText.includes(normalizedQuery)) return true;
  
  // Simple fuzzy logic: check if characters appear in order
  let queryIdx = 0;
  for (let textIdx = 0; textIdx < normalizedText.length; textIdx++) {
    if (normalizedText[textIdx] === normalizedQuery[queryIdx]) {
      queryIdx++;
    }
    if (queryIdx === normalizedQuery.length) return true;
  }
  
  return false;
}
