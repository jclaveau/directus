import { DisplayConfig, EndpointConfig, HookConfig, InterfaceConfig, LayoutConfig, ModuleConfig, OperationApiConfig, OperationAppConfig, PanelConfig } from "../types/index.js";
import { Prettify } from "@directus/types";

//#region src/shared/utils/define-extension.d.ts
type CustomConfig<T extends object> = { [K in string]: K extends keyof T ? never : unknown };
type ExtendedConfig<T extends object, C> = Prettify<T & Omit<C, keyof T>>;
declare function defineInterface<Custom extends CustomConfig<InterfaceConfig>>(config: ExtendedConfig<InterfaceConfig, Custom>): ExtendedConfig<InterfaceConfig, Custom>;
declare function defineDisplay<Custom extends CustomConfig<DisplayConfig>>(config: ExtendedConfig<DisplayConfig, Custom>): ExtendedConfig<DisplayConfig, Custom>;
declare function defineLayout<Options = any, Query = any>(config: LayoutConfig<Options, Query>): LayoutConfig<Options, Query>;
declare function defineModule<Custom extends CustomConfig<ModuleConfig>>(config: ExtendedConfig<ModuleConfig, Custom>): ExtendedConfig<ModuleConfig, Custom>;
declare function definePanel<Custom extends CustomConfig<PanelConfig>>(config: ExtendedConfig<PanelConfig, Custom>): ExtendedConfig<PanelConfig, Custom>;
declare function defineHook(config: HookConfig): HookConfig;
declare function defineEndpoint(config: EndpointConfig): EndpointConfig;
declare function defineOperationApp<Custom extends CustomConfig<OperationAppConfig>>(config: ExtendedConfig<OperationAppConfig, Custom>): ExtendedConfig<OperationAppConfig, Custom>;
declare function defineOperationApi<Options = Record<string, unknown>>(config: OperationApiConfig<Options>): OperationApiConfig<Options>;
//#endregion
export { defineDisplay, defineEndpoint, defineHook, defineInterface, defineLayout, defineModule, defineOperationApi, defineOperationApp, definePanel };