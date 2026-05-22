import { randomUUID as randomUUID$1 } from "node:crypto";

//#region src/constants.ts
const CHARACTERS_ALPHA = "abcdefghijklmnopqrstuvwxyz";

//#endregion
//#region src/sequence.ts
/**
* Return string of given length comprised of characters of given character set
*
* @param length - Length of the string to generate
* @param characters - Character set to use
*/
const randomSequence = (length, characters) => {
	let result = "";
	for (let i = length; i > 0; i--) result += characters[Math.floor(Math.random() * characters.length)];
	return result;
};

//#endregion
//#region src/alpha.ts
/**
* Return random string of alphabetic characters
*
* @param length - Length of the string to generate
*/
const randomAlpha = (length) => {
	return randomSequence(length, CHARACTERS_ALPHA);
};

//#endregion
//#region src/array.ts
/**
* Return a random item from a given array
*
* @param items - Array of any type of things
*/
const randomArray = (items) => {
	return items.at(Math.random() * items.length);
};

//#endregion
//#region src/integer.ts
/**
* Return a random integer between the given range
*
* @param min - Minimum
* @param max - Maximum
*/
const randomInteger = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

//#endregion
//#region src/identifier.ts
/**
* A wrapper to generate a random identifier.
*
* @returns A random identifier with 3 to 25 characters.
*/
const randomIdentifier = () => {
	return randomAlpha(randomInteger(3, 25));
};

//#endregion
//#region src/uuid.ts
/**
* Generate a random UUID
*/
const randomUUID = () => randomUUID$1();

//#endregion
export { randomAlpha, randomArray, randomIdentifier, randomInteger, randomSequence, randomUUID };