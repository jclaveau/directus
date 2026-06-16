import { DirectusFolder } from "../../../schema/folder.js";
import { DirectusFile } from "../../../schema/file.js";
import { AssetResponse, AssetsQuery } from "../../../types/assets.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/read/assets.d.ts

/**
* Read the contents of a file as a ReadableStream
*
* @param {string} key
* @param {AssetsQuery} query
* @returns {ReadableStream<Uint8Array>}
*/
declare const readAssetRaw: <Schema>(key: DirectusFile<Schema>["id"], query?: AssetsQuery) => RestCommand<ReadableStream<Uint8Array>, Schema>;
/**
* Read the contents of a file as a Blob
*
* @param {string} key
* @param {AssetsQuery} query
* @returns {Blob}
*/
declare const readAssetBlob: <Schema>(key: DirectusFile<Schema>["id"], query?: AssetsQuery) => RestCommand<Blob, Schema>;
/**
* Read the contents of a file as a ArrayBuffer
*
* @param {string} key
* @param {AssetsQuery} query
* @returns {ArrayBuffer}
*/
declare const readAssetArrayBuffer: <Schema>(key: DirectusFile<Schema>["id"], query?: AssetsQuery) => RestCommand<ArrayBuffer, Schema>;
/**
* Download a ZIP archive containing the specified files.
*
* @param keys An array of file IDs to include in the ZIP archive, must contain at least one ID.
* @param options
*/
declare const downloadFilesZip: <Schema, R extends keyof AssetResponse = "raw">(keys: DirectusFile<Schema>["id"][], options?: {
  output: R;
}) => RestCommand<AssetResponse[R], Schema>;
/**
* Download a ZIP archive of an entire folder tree.
*
* @param key The root folder ID to download.
* @param options
*/
declare const downloadFolderZip: <Schema, R extends keyof AssetResponse = "raw">(key: DirectusFolder<Schema>["id"], options?: {
  output: R;
}) => RestCommand<AssetResponse[R], Schema>;
//#endregion
export { downloadFilesZip, downloadFolderZip, readAssetArrayBuffer, readAssetBlob, readAssetRaw };
//# sourceMappingURL=assets.d.ts.map