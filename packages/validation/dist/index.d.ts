import * as _directus_errors0 from "@directus/errors";
import { ClientFilterOperator } from "@directus/types";
import { ValidationErrorItem } from "joi";

//#region src/errors/failed-validation.d.ts
interface FailedValidationErrorExtensions {
  field: string;
  path: (string | number)[];
  type: ClientFilterOperator | 'required' | 'email';
  valid?: number | string | (number | string)[];
  invalid?: number | string | (number | string)[];
  substring?: string;
}
declare const FailedValidationError: _directus_errors0.DirectusErrorConstructor<FailedValidationErrorExtensions>;
//#endregion
//#region src/utils/joi-to-error-extensions.d.ts
declare const joiValidationErrorItemToErrorExtensions: (validationErrorItem: ValidationErrorItem, path?: string[]) => FailedValidationErrorExtensions;
//#endregion
export { FailedValidationError, joiValidationErrorItemToErrorExtensions };