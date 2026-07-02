import { DirectusFile } from "../../../schema/file.cjs";
import { RestCommand } from "../../types.cjs";
import { AssetsQuery } from "../../../types/assets.cjs";

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
//#endregion
export { readAssetArrayBuffer, readAssetBlob, readAssetRaw };
//# sourceMappingURL=assets.d.cts.map