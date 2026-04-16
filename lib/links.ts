export const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;

const TRAILING_PUNCTUATION = /[),.;!?，。！？；：]+$/;

export function normalizeUrlMatch(value: string) {
  return value.replace(TRAILING_PUNCTUATION, "");
}

export function extractUrls(text: string | null | undefined) {
  if (!text) {
    return [];
  }

  const matches = text.match(URL_PATTERN) ?? [];
  return Array.from(new Set(matches.map(normalizeUrlMatch)));
}

export function getFirstUrl(text: string | null | undefined) {
  return extractUrls(text)[0] ?? null;
}
