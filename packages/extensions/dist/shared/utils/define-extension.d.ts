import { DisplayConfig as DisplayConfig$1, EndpointConfig as EndpointConfig$1, HookConfig as HookConfig$1, InterfaceConfig as InterfaceConfig$1, LayoutConfig as LayoutConfig$1, ModuleConfig as ModuleConfig$1, OperationApiConfig as OperationApiConfig$1, OperationAppConfig as OperationAppConfig$1, PanelConfig as PanelConfig$1 } from "../types/index.js";
import { Prettify } from "@directus/types";

//#region src/shared/utils/define-extension.d.ts
type CustomConfig<T extends object> = { [K in string]: K extends keyof T ? never : unknown };
type ExtendedConfig<T extends object, C> = Prettify<T & Omit<C, keyof T>>;
/** @deprecated Use `defineInterface` from `@directus/extensions-sdk/scalabus`. */
declare function defineInterface<Custom extends CustomConfig<InterfaceConfig$1>>(config: ExtendedConfig<InterfaceConfig$1, Custom>): ExtendedConfig<InterfaceConfig$1, Custom>;
/** @deprecated Use `defineDisplay` from `@directus/extensions-sdk/scalabus`. */
declare function defineDisplay<Custom extends CustomConfig<DisplayConfig$1>>(config: ExtendedConfig<DisplayConfig$1, Custom>): ExtendedConfig<DisplayConfig$1, Custom>;
/** @deprecated Use `defineLayout` from `@directus/extensions-sdk/scalabus`. */
declare function defineLayout<Options = any, Query = any>(config: LayoutConfig$1<Options, Query>): LayoutConfig$1<Options, Query>;
/** @deprecated Use `defineModule` from `@directus/extensions-sdk/scalabus`. */
declare function defineModule<Custom extends CustomConfig<ModuleConfig$1>>(config: ExtendedConfig<ModuleConfig$1, Custom>): ExtendedConfig<ModuleConfig$1, Custom>;
/** @deprecated Use `definePanel` from `@directus/extensions-sdk/scalabus`. */
declare function definePanel<Custom extends CustomConfig<PanelConfig$1>>(config: ExtendedConfig<PanelConfig$1, Custom>): ExtendedConfig<PanelConfig$1, Custom>;
/** @deprecated Use `defineHook` from `@directus/extensions-sdk/scalabus`. */
declare function defineHook(config: HookConfig$1): HookConfig$1;
/** @deprecated Use `defineEndpoint` from `@directus/extensions-sdk/scalabus`. */
declare function defineEndpoint(config: EndpointConfig$1): EndpointConfig$1;
/** @deprecated Use `defineOperationApp` from `@directus/extensions-sdk/scalabus`. */
declare function defineOperationApp<Custom extends CustomConfig<OperationAppConfig$1>>(config: ExtendedConfig<OperationAppConfig$1, Custom>): ExtendedConfig<OperationAppConfig$1, Custom>;
/** @deprecated Use `defineOperationApi` from `@directus/extensions-sdk/scalabus`. */
declare function defineOperationApi<Options = Record<string, unknown>>(config: OperationApiConfig$1<Options>): OperationApiConfig$1<Options>;
//#endregion
export { defineDisplay, defineEndpoint, defineHook, defineInterface, defineLayout, defineModule, defineOperationApi, defineOperationApp, definePanel };