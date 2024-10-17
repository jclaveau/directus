import * as pinia from 'pinia';
import * as vue from 'vue';
import * as _vueuse_shared from '@vueuse/shared';

/**
 * Global application state
 */
declare const useAppStore: pinia.StoreDefinition<"appStore", pinia._UnwrapAll<Pick<{
    navbarOpen: _vueuse_shared.RemovableRef<boolean>;
    sidebarOpen: _vueuse_shared.RemovableRef<boolean>;
    notificationsDrawerOpen: vue.Ref<boolean>;
    fullScreen: vue.Ref<boolean>;
    hydrated: vue.Ref<boolean>;
    hydrating: vue.Ref<boolean>;
    error: vue.Ref<null>;
    authenticated: vue.Ref<boolean>;
    accessTokenExpiry: vue.Ref<number>;
    basemap: vue.Ref<string>;
}, "navbarOpen" | "sidebarOpen" | "notificationsDrawerOpen" | "fullScreen" | "hydrated" | "hydrating" | "error" | "authenticated" | "accessTokenExpiry" | "basemap">>, Pick<{
    navbarOpen: _vueuse_shared.RemovableRef<boolean>;
    sidebarOpen: _vueuse_shared.RemovableRef<boolean>;
    notificationsDrawerOpen: vue.Ref<boolean>;
    fullScreen: vue.Ref<boolean>;
    hydrated: vue.Ref<boolean>;
    hydrating: vue.Ref<boolean>;
    error: vue.Ref<null>;
    authenticated: vue.Ref<boolean>;
    accessTokenExpiry: vue.Ref<number>;
    basemap: vue.Ref<string>;
}, never>, Pick<{
    navbarOpen: _vueuse_shared.RemovableRef<boolean>;
    sidebarOpen: _vueuse_shared.RemovableRef<boolean>;
    notificationsDrawerOpen: vue.Ref<boolean>;
    fullScreen: vue.Ref<boolean>;
    hydrated: vue.Ref<boolean>;
    hydrating: vue.Ref<boolean>;
    error: vue.Ref<null>;
    authenticated: vue.Ref<boolean>;
    accessTokenExpiry: vue.Ref<number>;
    basemap: vue.Ref<string>;
}, never>>;

export { useAppStore };
