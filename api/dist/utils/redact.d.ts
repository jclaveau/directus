import type { UnknownObject } from '@directus/types';
type Paths = string[][];
/**
 * Redact values at certain paths in an object.
 * @param input Input object in which values should be redacted.
 * @param paths Nested array of object paths to be redacted (supports `*` for shallow matching, `**` for deep matching).
 * @param replacement Replacement the values are redacted by.
 * @returns Redacted object.
 */
export declare function redact(input: UnknownObject, paths: Paths, replacement: string): UnknownObject;
/**
 * Extract values from Error objects for use with JSON.stringify()
 */
export declare function errorReplacer(_key: string, value: unknown): unknown;
export {};
