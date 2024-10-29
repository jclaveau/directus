// src/constants.ts
var CHARACTERS_ALPHA = "abcdefghijklmnopqrstuvwxyz";

// src/sequence.ts
var randomSequence = (length, characters) => {
  let result = "";
  for (let i = length; i > 0; i--) {
    result += characters[Math.floor(Math.random() * characters.length)];
  }
  return result;
};

// src/alpha.ts
var randomAlpha = (length) => {
  return randomSequence(length, CHARACTERS_ALPHA);
};

// src/array.ts
var randomArray = (items) => {
  return items.at(Math.random() * items.length);
};

// src/integer.ts
var randomInteger = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

// src/identifier.ts
var randomIdentifier = () => {
  return randomAlpha(randomInteger(3, 25));
};

// src/uuid.ts
import { randomUUID as randUUID } from "crypto";
var randomUUID = () => randUUID();
export {
  randomAlpha,
  randomArray,
  randomIdentifier,
  randomInteger,
  randomSequence,
  randomUUID
};
