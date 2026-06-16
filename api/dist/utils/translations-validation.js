import { z as z$1 } from "zod";
import { REGEX_DB_SAFE_IDENTIFIER } from "@directus/constants";

//#region src/utils/translations-validation.ts
const DB_SAFE_IDENTIFIER_MESSAGE = "must be a db-safe identifier (letters, numbers, underscores; cannot start with a number)";
const dbSafeIdentifierSchema = z$1.string().trim().min(1).max(63).regex(REGEX_DB_SAFE_IDENTIFIER, DB_SAFE_IDENTIFIER_MESSAGE);

//#endregion
export { dbSafeIdentifierSchema };