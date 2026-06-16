import { i as EditConfig$1, s as SavedData } from "./directus-CyWNkLfU.cjs";

//#region src/lib/types/index.d.ts
type EditConfigStrict = EditConfig$1;
type EditConfig = Omit<EditConfigStrict, 'fields'> & {
  fields?: EditConfigStrict['fields'] | string;
};
type EditableElementOptions = {
  customClass?: string | undefined;
  onSaved?: ((data: Omit<SavedData, 'key'>) => void) | undefined;
};
//#endregion
//#region src/index.d.ts
declare function apply({
  directusUrl,
  elements,
  customClass,
  onSaved
}: {
  directusUrl: string;
  elements?: HTMLElement | HTMLElement[] | null;
} & EditableElementOptions): Promise<{
  remove(): void;
  enable(): void;
  disable(): void;
} | undefined>;
declare function remove(): void;
declare function disable(): {
  enable(): void;
};
declare function setAttr(editConfig: EditConfig): string;
//#endregion
export { apply, disable, remove, setAttr };
//# sourceMappingURL=index.d.cts.map