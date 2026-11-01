import { z } from 'zod';
import type { Theme } from './themes.js';
import type { API_EXTENSION_TYPES, APP_EXTENSION_TYPES, BUNDLE_EXTENSION_TYPES, EXTENSION_TYPES, HYBRID_EXTENSION_TYPES, NESTED_EXTENSION_TYPES } from '@directus/constants';
import type { EndpointConfig } from './endpoints.js';
import type { HookConfig } from './hooks.js';
import type { DisplayConfig } from './displays.js';
import type { InterfaceConfig } from './interfaces.js';
import type { LayoutConfig } from './layouts.js';
import type { ModuleConfig } from './modules.js';
import type { OperationApiConfig, OperationAppConfig } from './operations.js';
import type { PanelConfig } from './panels.js';
export type AppExtensionConfigs = {
    interfaces: InterfaceConfig[];
    displays: DisplayConfig[];
    layouts: LayoutConfig[];
    modules: ModuleConfig[];
    panels: PanelConfig[];
    themes: Theme[];
    operations: OperationAppConfig[];
};
export declare const SplitEntrypoint: z.ZodObject<{
    app: z.ZodString;
    api: z.ZodString;
}, z.core.$strip>;
export type SplitEntrypoint = z.infer<typeof SplitEntrypoint>;
export declare const ExtensionSandboxRequestedScopes: z.ZodObject<{
    request: z.ZodOptional<z.ZodObject<{
        urls: z.ZodArray<z.ZodString>;
        methods: z.ZodArray<z.ZodUnion<readonly [z.ZodLiteral<"GET">, z.ZodLiteral<"POST">, z.ZodLiteral<"PATCH">, z.ZodLiteral<"PUT">, z.ZodLiteral<"DELETE">]>>;
    }, z.core.$strip>>;
    log: z.ZodOptional<z.ZodObject<{}, z.core.$strip>>;
    sleep: z.ZodOptional<z.ZodObject<{}, z.core.$strip>>;
}, z.core.$strip>;
export type ExtensionSandboxRequestedScopes = z.infer<typeof ExtensionSandboxRequestedScopes>;
export declare const ExtensionSandboxOptions: z.ZodOptional<z.ZodObject<{
    enabled: z.ZodBoolean;
    requestedScopes: z.ZodObject<{
        request: z.ZodOptional<z.ZodObject<{
            urls: z.ZodArray<z.ZodString>;
            methods: z.ZodArray<z.ZodUnion<readonly [z.ZodLiteral<"GET">, z.ZodLiteral<"POST">, z.ZodLiteral<"PATCH">, z.ZodLiteral<"PUT">, z.ZodLiteral<"DELETE">]>>;
        }, z.core.$strip>>;
        log: z.ZodOptional<z.ZodObject<{}, z.core.$strip>>;
        sleep: z.ZodOptional<z.ZodObject<{}, z.core.$strip>>;
    }, z.core.$strip>;
}, z.core.$strip>>;
export type ExtensionSandboxOptions = z.infer<typeof ExtensionSandboxOptions>;
export interface ExtensionSettings {
    id: string;
    source: 'module' | 'registry' | 'local';
    enabled: boolean;
    bundle: string | null;
    folder: string;
}
/**
 * The API output structure used when engaging with the /extensions endpoints
 */
export interface ApiOutput {
    id: string;
    bundle: string | null;
    schema: Partial<Extension> | BundleExtensionEntry | null;
    meta: ExtensionSettings;
}
export type BundleConfig = {
    endpoints: {
        name: string;
        config: EndpointConfig;
    }[];
    hooks: {
        name: string;
        config: HookConfig;
    }[];
    operations: {
        name: string;
        config: OperationApiConfig;
    }[];
};
export type AppExtensionType = (typeof APP_EXTENSION_TYPES)[number];
export type ApiExtensionType = (typeof API_EXTENSION_TYPES)[number];
export type HybridExtensionType = (typeof HYBRID_EXTENSION_TYPES)[number];
export type BundleExtensionType = (typeof BUNDLE_EXTENSION_TYPES)[number];
export type NestedExtensionType = (typeof NESTED_EXTENSION_TYPES)[number];
export type ExtensionType = (typeof EXTENSION_TYPES)[number];
type ExtensionBase = {
    path: string;
    name: string;
    local: boolean;
    version?: string;
    host?: string;
};
export type AppExtension = ExtensionBase & {
    type: AppExtensionType;
    entrypoint: string;
};
export type ApiExtension = ExtensionBase & {
    type: ApiExtensionType;
    entrypoint: string;
    sandbox?: ExtensionSandboxOptions;
};
export type HybridExtension = ExtensionBase & {
    type: HybridExtensionType;
    entrypoint: SplitEntrypoint;
    sandbox?: ExtensionSandboxOptions;
};
export interface BundleExtensionEntry {
    name: string;
    type: AppExtensionType | ApiExtensionType | HybridExtensionType;
}
export type BundleExtension = ExtensionBase & {
    type: BundleExtensionType;
    partial: boolean | undefined;
    entrypoint: SplitEntrypoint;
    entries: BundleExtensionEntry[];
};
export type Extension = AppExtension | ApiExtension | HybridExtension | BundleExtension;
export {};
