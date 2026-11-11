import { DisplayConfig, EndpointConfig, HookConfig, InterfaceConfig, LayoutConfig, ModuleConfig, OperationApiConfig, OperationAppConfig, PanelConfig, Theme } from "@directus/types";
import { Knex } from "knex";

//#region src/scalabus/define-entry.d.ts
declare const BUNDLE_ENTRIES_FORMAT = "scalabus/1";
declare const MIGRATION_PHASES: readonly ["before-schema", "after-schema"];
type MigrationPhase = (typeof MIGRATION_PHASES)[number];
type MigrationTransactionScope = 'batch' | 'own' | 'none';
interface MigrationConfig {
  up: (knex: Knex) => Promise<void>;
  down: (knex: Knex) => Promise<void>;
  transactionScope?: MigrationTransactionScope;
  phase?: MigrationPhase;
}
type HookEntry = {
  type: 'hook';
  name: string;
  config: HookConfig;
};
type EndpointEntry = {
  type: 'endpoint';
  name: string;
  config: EndpointConfig;
};
type OperationApiEntry = {
  type: 'operation';
  name: string;
  config: OperationApiConfig;
};
type MigrationEntry = {
  type: 'migration';
  name: string;
  config: MigrationConfig;
};
type InterfaceEntry = {
  type: 'interface';
  name: string;
  config: InterfaceConfig;
};
type DisplayEntry = {
  type: 'display';
  name: string;
  config: DisplayConfig;
};
type LayoutEntry = {
  type: 'layout';
  name: string;
  config: LayoutConfig;
};
type ModuleEntry = {
  type: 'module';
  name: string;
  config: ModuleConfig;
};
type PanelEntry = {
  type: 'panel';
  name: string;
  config: PanelConfig;
};
type ThemeEntry = {
  type: 'theme';
  name: string;
  config: Theme;
};
type OperationAppEntry = {
  type: 'operation';
  name: string;
  config: OperationAppConfig;
};
type BundleApiEntry = HookEntry | EndpointEntry | OperationApiEntry | MigrationEntry;
type BundleAppEntry = InterfaceEntry | DisplayEntry | LayoutEntry | ModuleEntry | PanelEntry | ThemeEntry | OperationAppEntry;
interface BundleEntries<Entry extends BundleApiEntry | BundleAppEntry> {
  format: typeof BUNDLE_ENTRIES_FORMAT;
  entries: Entry[];
}
declare function defineHook(name: string, config: HookConfig): HookEntry;
declare function defineEndpoint(name: string, config: EndpointConfig): EndpointEntry;
declare function defineOperationApi<Options = Record<string, unknown>>(name: string, config: OperationApiConfig<Options>): OperationApiEntry;
declare function defineMigration(name: string, config: MigrationConfig): MigrationEntry;
declare function defineInterface(name: string, config: InterfaceConfig): InterfaceEntry;
declare function defineDisplay(name: string, config: DisplayConfig): DisplayEntry;
declare function defineLayout<Options = any, Query = any>(name: string, config: LayoutConfig<Options, Query>): LayoutEntry;
declare function defineModule(name: string, config: ModuleConfig): ModuleEntry;
declare function definePanel(name: string, config: PanelConfig): PanelEntry;
declare function defineTheme(name: string, config: Theme): ThemeEntry;
declare function defineOperationApp(name: string, config: OperationAppConfig): OperationAppEntry;
declare function defineBundleApi(entries: BundleApiEntry[]): BundleEntries<BundleApiEntry>;
declare function defineBundleApp(entries: BundleAppEntry[]): BundleEntries<BundleAppEntry>;
//#endregion
export { BUNDLE_ENTRIES_FORMAT, BundleApiEntry, BundleAppEntry, BundleEntries, DisplayEntry, EndpointEntry, HookEntry, InterfaceEntry, LayoutEntry, MIGRATION_PHASES, MigrationConfig, MigrationEntry, MigrationPhase, MigrationTransactionScope, ModuleEntry, OperationApiEntry, OperationAppEntry, PanelEntry, ThemeEntry, defineBundleApi, defineBundleApp, defineDisplay, defineEndpoint, defineHook, defineInterface, defineLayout, defineMigration, defineModule, defineOperationApi, defineOperationApp, definePanel, defineTheme };