import type { Prettify } from '@directus/types';
import type {
	DisplayConfig,
	EndpointConfig,
	HookConfig,
	InterfaceConfig,
	LayoutConfig,
	ModuleConfig,
	OperationApiConfig,
	OperationAppConfig,
	PanelConfig,
} from '../types/index.js';

type CustomConfig<T extends object> = { [K in string]: K extends keyof T ? never : unknown };

type ExtendedConfig<T extends object, C> = Prettify<T & Omit<C, keyof T>>;

/** @deprecated Use `defineInterfaceEntry` from the sdk's `scalabus` export. */
export function defineInterface<Custom extends CustomConfig<InterfaceConfig>>(
	config: ExtendedConfig<InterfaceConfig, Custom>,
): ExtendedConfig<InterfaceConfig, Custom> {
	return config;
}

/** @deprecated Use `defineDisplayEntry` from the sdk's `scalabus` export. */
export function defineDisplay<Custom extends CustomConfig<DisplayConfig>>(
	config: ExtendedConfig<DisplayConfig, Custom>,
): ExtendedConfig<DisplayConfig, Custom> {
	return config;
}

/** @deprecated Use `defineLayoutEntry` from the sdk's `scalabus` export. */
export function defineLayout<Options = any, Query = any>(
	config: LayoutConfig<Options, Query>,
): LayoutConfig<Options, Query> {
	return config;
}

/** @deprecated Use `defineModuleEntry` from the sdk's `scalabus` export. */
export function defineModule<Custom extends CustomConfig<ModuleConfig>>(
	config: ExtendedConfig<ModuleConfig, Custom>,
): ExtendedConfig<ModuleConfig, Custom> {
	return config;
}

/** @deprecated Use `definePanelEntry` from the sdk's `scalabus` export. */
export function definePanel<Custom extends CustomConfig<PanelConfig>>(
	config: ExtendedConfig<PanelConfig, Custom>,
): ExtendedConfig<PanelConfig, Custom> {
	return config;
}

/** @deprecated Use `defineHookEntry` from the sdk's `scalabus` export. */
export function defineHook(config: HookConfig): HookConfig {
	return config;
}

/** @deprecated Use `defineEndpointEntry` from the sdk's `scalabus` export. */
export function defineEndpoint(config: EndpointConfig): EndpointConfig {
	return config;
}

/** @deprecated Use `defineOperationAppEntry` from the sdk's `scalabus` export. */
export function defineOperationApp<Custom extends CustomConfig<OperationAppConfig>>(
	config: ExtendedConfig<OperationAppConfig, Custom>,
): ExtendedConfig<OperationAppConfig, Custom> {
	return config;
}

/** @deprecated Use `defineOperationApiEntry` from the sdk's `scalabus` export. */
export function defineOperationApi<Options = Record<string, unknown>>(
	config: OperationApiConfig<Options>,
): OperationApiConfig<Options> {
	return config;
}
