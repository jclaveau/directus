import * as pinia0 from "pinia";
import * as vue0 from "vue";

//#region src/app.d.ts
/**
 * Global application state
 */
declare const useAppStore: pinia0.StoreDefinition<"appStore", Pick<{
  notificationsDrawerOpen: vue0.Ref<boolean, boolean>;
  hydrated: vue0.Ref<boolean, boolean>;
  hydrating: vue0.Ref<boolean, boolean>;
  error: vue0.Ref<null, null>;
  authenticated: vue0.Ref<boolean, boolean>;
  accessTokenExpiry: vue0.Ref<number, number>;
  basemap: vue0.Ref<string, string>;
}, "notificationsDrawerOpen" | "hydrated" | "hydrating" | "error" | "authenticated" | "accessTokenExpiry" | "basemap">, Pick<{
  notificationsDrawerOpen: vue0.Ref<boolean, boolean>;
  hydrated: vue0.Ref<boolean, boolean>;
  hydrating: vue0.Ref<boolean, boolean>;
  error: vue0.Ref<null, null>;
  authenticated: vue0.Ref<boolean, boolean>;
  accessTokenExpiry: vue0.Ref<number, number>;
  basemap: vue0.Ref<string, string>;
}, never>, Pick<{
  notificationsDrawerOpen: vue0.Ref<boolean, boolean>;
  hydrated: vue0.Ref<boolean, boolean>;
  hydrating: vue0.Ref<boolean, boolean>;
  error: vue0.Ref<null, null>;
  authenticated: vue0.Ref<boolean, boolean>;
  accessTokenExpiry: vue0.Ref<number, number>;
  basemap: vue0.Ref<string, string>;
}, never>>;
//#endregion
export { useAppStore };