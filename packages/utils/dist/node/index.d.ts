import { Readable } from "node:stream";
import { Plural } from "@directus/types";

//#region node/array-helpers.d.ts
declare function isIn<T extends readonly string[]>(value: string, array: T): value is T[number];
declare function isTypeIn<T extends {
  type?: string;
}, E extends string>(object: T, array: readonly E[]): object is Extract<T, {
  type?: E;
}>;
//#endregion
//#region node/get-node-env.d.ts
/**
 * Get the configured Node Environment (eg "production", "development", etc)
 */
declare const getNodeEnv: () => string | undefined;
//#endregion
//#region node/is-readable-stream.d.ts
declare const isReadableStream: (input: any) => input is Readable;
//#endregion
//#region node/list-folders.d.ts
interface ListFoldersOptions {
  /**
   * Ignore folders starting with a period `.`
   */
  ignoreHidden?: boolean;
}
declare function listFolders(location: string, options?: ListFoldersOptions): Promise<string[]>;
//#endregion
//#region node/path-to-relative-url.d.ts
declare function pathToRelativeUrl(filePath: string, root?: string): string;
//#endregion
//#region node/pluralize.d.ts
declare function pluralize<T extends string>(str: T): Plural<T>;
declare function depluralize<T extends string>(str: Plural<T>): T;
//#endregion
//#region node/process-id.d.ts
declare const _cache: {
  id: string | undefined;
};
/**
 * Return a unique hash for the current process on the current machine. Will be different after a
 * restart
 */
declare const processId: () => string;
//#endregion
//#region node/readable-stream-to-string.d.ts
declare const readableStreamToString: (stream: Readable) => Promise<string>;
//#endregion
//#region node/require-yaml.d.ts
declare const requireYaml: (filepath: string) => unknown;
//#endregion
//#region node/resolve-package.d.ts
declare function resolvePackage(name: string, root?: string): string;
//#endregion
//#region node/tmp.d.ts
declare function createTmpFile(): Promise<{
  path: string;
  cleanup: () => Promise<void>;
}>;
//#endregion
export { _cache, createTmpFile, depluralize, getNodeEnv, isIn, isReadableStream, isTypeIn, listFolders, pathToRelativeUrl, pluralize, processId, readableStreamToString, requireYaml, resolvePackage };