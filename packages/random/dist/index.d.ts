/**
 * Return random string of alphabetic characters
 *
 * @param length - Length of the string to generate
 */
declare const randomAlpha: (length: number) => string;

/**
 * Return a random item from a given array
 *
 * @param items - Array of any type of things
 */
declare const randomArray: <T = unknown>(items: readonly T[]) => T;

/**
 * A wrapper to generate a random identifier.
 *
 * @returns A random identifier with 3 to 25 characters.
 */
declare const randomIdentifier: () => string;

/**
 * Return a random integer between the given range
 *
 * @param min - Minimum
 * @param max - Maximum
 */
declare const randomInteger: (min: number, max: number) => number;

/**
 * Return string of given length comprised of characters of given character set
 *
 * @param length - Length of the string to generate
 * @param characters - Character set to use
 */
declare const randomSequence: (length: number, characters: string) => string;

/**
 * Generate a random UUID
 */
declare const randomUUID: () => `${string}-${string}-${string}-${string}-${string}`;

export { randomAlpha, randomArray, randomIdentifier, randomInteger, randomSequence, randomUUID };
