export const getRedactedString = (key) => `--redacted${key ? `:${key}` : ''}--`;
export const REDACTED_TEXT = getRedactedString();
