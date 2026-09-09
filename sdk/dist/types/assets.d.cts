//#region src/types/assets.d.ts
/**
 * The assets endpoint query parameters
 */
type AssetsQuery = {
  key: string;
} | {
  key?: never;
  fit?: 'cover' | 'contain' | 'inside' | 'outside';
  width?: number;
  height?: number;
  quality?: number;
  withoutEnlargement?: boolean;
  format?: 'auto' | 'jpg' | 'png' | 'webp' | 'tiff';
  focal_point_x?: number;
  focal_point_y?: number;
  transforms?: [string, ...any[]][];
};
//#endregion
export { AssetsQuery };
//# sourceMappingURL=assets.d.cts.map