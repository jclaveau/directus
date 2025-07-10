import * as pinia from 'pinia';
import * as vue from 'vue';
import * as _vueuse_core from '@vueuse/core';

/**
 * Global application state
 */
declare const useAppStore: pinia.StoreDefinition<"appStore", Pick<{
    navbarOpen: _vueuse_core.RemovableRef<boolean>;
    sidebarOpen: _vueuse_core.RemovableRef<boolean>;
    notificationsDrawerOpen: vue.Ref<boolean, boolean>;
    fullScreen: vue.Ref<boolean, boolean>;
    hydrated: vue.Ref<boolean, boolean>;
    hydrating: vue.Ref<boolean, boolean>;
    error: vue.Ref<null, null>;
    authenticated: vue.Ref<boolean, boolean>;
    accessTokenExpiry: vue.Ref<number, number>;
    basemap: vue.Ref<string, string>;
}, "navbarOpen" | "sidebarOpen" | "notificationsDrawerOpen" | "fullScreen" | "hydrated" | "hydrating" | "error" | "authenticated" | "accessTokenExpiry" | "basemap">, Pick<{
    navbarOpen: _vueuse_core.RemovableRef<boolean>;
    sidebarOpen: _vueuse_core.RemovableRef<boolean>;
    notificationsDrawerOpen: vue.Ref<boolean, boolean>;
    fullScreen: vue.Ref<boolean, boolean>;
    hydrated: vue.Ref<boolean, boolean>;
    hydrating: vue.Ref<boolean, boolean>;
    error: vue.Ref<null, null>;
    authenticated: vue.Ref<boolean, boolean>;
    accessTokenExpiry: vue.Ref<number, number>;
    basemap: vue.Ref<string, string>;
}, never>, Pick<{
    navbarOpen: _vueuse_core.RemovableRef<boolean>;
    sidebarOpen: _vueuse_core.RemovableRef<boolean>;
    notificationsDrawerOpen: vue.Ref<boolean, boolean>;
    fullScreen: vue.Ref<boolean, boolean>;
    hydrated: vue.Ref<boolean, boolean>;
    hydrating: vue.Ref<boolean, boolean>;
    error: vue.Ref<null, null>;
    authenticated: vue.Ref<boolean, boolean>;
    accessTokenExpiry: vue.Ref<number, number>;
    basemap: vue.Ref<string, string>;
}, never>>;

export { useAppStore };
