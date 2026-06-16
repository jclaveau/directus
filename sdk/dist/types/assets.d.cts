//#region src/types/assets.d.ts
/**
* The assets endpoint query parameters
*/
type AssetsQuery = {
  key: string;
} | {
  key?: never;
  fit?: "cover" | "contain" | "inside" | "outside";
  width?: number;
  height?: number;
  quality?: number;
  withoutEnlargement?: boolean;
  format?: "auto" | "jpg" | "png" | "webp" | "tiff";
  focal_point_x?: number;
  focal_point_y?: number;
  transforms?: [string, ...any[]][];
};
/**
* A Map of response `type` to the corresponding response format.
*/
type AssetResponse = {
  raw: ReadableStream<Uint8Array>;
  arrayBuffer: ArrayBuffer;
  blob: Blob;
};
//#endregion
export { AssetResponse, AssetsQuery };
//# sourceMappingURL=assets.d.cts.map