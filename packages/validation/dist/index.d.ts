import { DirectusErrorConstructor } from "@directus/errors";
import { ClientFilterOperator } from "@directus/types";
import { ValidationErrorItem } from "joi";

//#region src/errors/failed-validation.d.ts
type ImportRowLines = {
  type: "lines";
  rows: number[];
};
type ImportRowRange = {
  type: "range";
  start: number;
  end: number;
};
interface FailedValidationErrorExtensions {
  field: string;
  path: (string | number)[];
  type: ClientFilterOperator | "required" | "email";
  valid?: number | string | (number | string)[];
  invalid?: number | string | (number | string)[];
  substring?: string;
  rows?: (ImportRowLines | ImportRowRange)[];
}
declare const FailedValidationError: DirectusErrorConstructor<FailedValidationErrorExtensions>;
//#endregion
//#region src/utils/joi-to-error-extensions.d.ts
declare const joiValidationErrorItemToErrorExtensions: (validationErrorItem: ValidationErrorItem, path?: string[]) => FailedValidationErrorExtensions;
//#endregion
export { FailedValidationError, type FailedValidationErrorExtensions, type ImportRowLines, type ImportRowRange, joiValidationErrorItemToErrorExtensions };