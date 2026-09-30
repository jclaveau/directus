import * as _vueuse_core0 from "@vueuse/core";
import * as pinia0 from "pinia";
import * as vue0 from "vue";

//#region src/app.d.ts
/**
 * Global application state
 */
declare const useAppStore: pinia0.StoreDefinition<"appStore", Pick<{
  navbarOpen: _vueuse_core0.RemovableRef<boolean>;
  sidebarOpen: _vueuse_core0.RemovableRef<boolean>;
  notificationsDrawerOpen: vue0.Ref<boolean, boolean>;
  fullScreen: vue0.Ref<boolean, boolean>;
  hydrated: vue0.Ref<boolean, boolean>;
  hydrating: vue0.Ref<boolean, boolean>;
  error: vue0.Ref<null, null>;
  authenticated: vue0.Ref<boolean, boolean>;
  accessTokenExpiry: vue0.Ref<number, number>;
  basemap: vue0.Ref<string, string>;
}, "navbarOpen" | "sidebarOpen" | "notificationsDrawerOpen" | "fullScreen" | "hydrated" | "hydrating" | "error" | "authenticated" | "accessTokenExpiry" | "basemap">, Pick<{
  navbarOpen: _vueuse_core0.RemovableRef<boolean>;
  sidebarOpen: _vueuse_core0.RemovableRef<boolean>;
  notificationsDrawerOpen: vue0.Ref<boolean, boolean>;
  fullScreen: vue0.Ref<boolean, boolean>;
  hydrated: vue0.Ref<boolean, boolean>;
  hydrating: vue0.Ref<boolean, boolean>;
  error: vue0.Ref<null, null>;
  authenticated: vue0.Ref<boolean, boolean>;
  accessTokenExpiry: vue0.Ref<number, number>;
  basemap: vue0.Ref<string, string>;
}, never>, Pick<{
  navbarOpen: _vueuse_core0.RemovableRef<boolean>;
  sidebarOpen: _vueuse_core0.RemovableRef<boolean>;
  notificationsDrawerOpen: vue0.Ref<boolean, boolean>;
  fullScreen: vue0.Ref<boolean, boolean>;
  hydrated: vue0.Ref<boolean, boolean>;
  hydrating: vue0.Ref<boolean, boolean>;
  error: vue0.Ref<null, null>;
  authenticated: vue0.Ref<boolean, boolean>;
  accessTokenExpiry: vue0.Ref<number, number>;
  basemap: vue0.Ref<string, string>;
}, never>>;
//#endregion
export { useAppStore };