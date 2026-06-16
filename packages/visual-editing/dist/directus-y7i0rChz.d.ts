import { PrimaryKey } from "@directus/types";

//#region src/lib/types/directus.d.ts
type EditConfig = {
  collection: string;
  item: PrimaryKey | null;
  fields?: string[];
  mode?: 'drawer' | 'modal' | 'popover';
};
type SavedData = {
  key: string;
  collection: EditConfig['collection'];
  item: EditConfig['item'];
  payload: Record<string, unknown>;
};
type CheckFieldAccessData = {
  key: string;
  collection: EditConfig['collection'];
  item: EditConfig['item'];
  fields: string[];
};
type AddToContextData = {
  key: string;
  editConfig: EditConfig;
  rect?: DOMRect;
};
type HighlightElementData = {
  key?: string | null;
  collection?: string;
  item?: PrimaryKey;
  fields?: string[];
};
type ConfirmData = {
  aiEnabled: boolean;
  theme?: VisualEditingTheme;
  messages?: VisualEditingMessages;
};
type VisualEditingTheme = {
  primaryColor: string | undefined;
  primaryAccentColor: string | undefined;
  borderRadius: string | undefined;
  buttonSize: string | undefined;
  focusRingWidth: string | undefined;
  focusRingOffset: string | undefined;
};
type VisualEditingMessages = {
  edit: string;
  addToContext: string;
};
type ReceiveAction = 'connect' | 'checkFieldAccess' | 'edit' | 'navigation' | 'addToContext';
type SendAction = 'confirm' | 'activateElements' | 'showEditableElements' | 'saved' | 'highlightElement';
//#endregion
export { HighlightElementData as a, SendAction as c, EditConfig as i, VisualEditingMessages as l, CheckFieldAccessData as n, ReceiveAction as o, ConfirmData as r, SavedData as s, AddToContextData as t, VisualEditingTheme as u };
//# sourceMappingURL=directus-y7i0rChz.d.ts.map