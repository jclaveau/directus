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
	Theme,
} from '@directus/types';
import type { Knex } from 'knex';

export const BUNDLE_ENTRIES_FORMAT = 'scalabus/1';

export const MIGRATION_PHASES = ['before-schema', 'after-schema'] as const;

export type MigrationPhase = (typeof MIGRATION_PHASES)[number];

export type MigrationTransactionScope = 'batch' | 'own' | 'none';

export interface MigrationConfig {
	up: (knex: Knex) => Promise<void>;
	down: (knex: Knex) => Promise<void>;
	transactionScope?: MigrationTransactionScope;
	phase?: MigrationPhase;
}

export type HookEntry = { type: 'hook'; name: string; config: HookConfig };
export type EndpointEntry = {
	type: 'endpoint';
	name: string;
	config: EndpointConfig;
};
export type OperationApiEntry = {
	type: 'operation';
	name: string;
	config: OperationApiConfig;
};
export type MigrationEntry = {
	type: 'migration';
	name: string;
	config: MigrationConfig;
};

export type InterfaceEntry = {
	type: 'interface';
	name: string;
	config: InterfaceConfig;
};
export type DisplayEntry = { type: 'display'; name: string; config: DisplayConfig };
export type LayoutEntry = { type: 'layout'; name: string; config: LayoutConfig };
export type ModuleEntry = { type: 'module'; name: string; config: ModuleConfig };
export type PanelEntry = { type: 'panel'; name: string; config: PanelConfig };
export type ThemeEntry = { type: 'theme'; name: string; config: Theme };
export type OperationAppEntry = {
	type: 'operation';
	name: string;
	config: OperationAppConfig;
};

export type BundleApiEntry =
	| HookEntry
	| EndpointEntry
	| OperationApiEntry
	| MigrationEntry;

export type BundleAppEntry =
	| InterfaceEntry
	| DisplayEntry
	| LayoutEntry
	| ModuleEntry
	| PanelEntry
	| ThemeEntry
	| OperationAppEntry;

export interface BundleEntries<Entry extends BundleApiEntry | BundleAppEntry> {
	format: typeof BUNDLE_ENTRIES_FORMAT;
	entries: Entry[];
}

const MIGRATION_NAME_PATTERN = /^\d{8}[A-Z]-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function defineHookEntry(name: string, config: HookConfig): HookEntry {
	return { type: 'hook', name, config };
}

export function defineEndpointEntry(
	name: string,
	config: EndpointConfig,
): EndpointEntry {
	return { type: 'endpoint', name, config };
}

export function defineOperationApiEntry<Options = Record<string, unknown>>(
	name: string,
	config: OperationApiConfig<Options>,
): OperationApiEntry {
	return { type: 'operation', name, config: config as OperationApiConfig };
}

export function defineMigrationEntry(
	name: string,
	config: MigrationConfig,
): MigrationEntry {
	if (!MIGRATION_NAME_PATTERN.test(name)) {
		throw new Error(
			`Migration entry ${JSON.stringify(name)} must be named `
				+ `"<date><letter>-<slug>",`
				+ ` like "20260212A-add-orders"`,
		);
	}

	const phase = config.phase ?? 'before-schema';

	if (!MIGRATION_PHASES.includes(phase)) {
		throw new Error(
			`Migration entry ${JSON.stringify(name)} declares an unknown phase`
				+ ` ${JSON.stringify(phase)}; expected "before-schema" or "after-schema"`,
		);
	}

	return { type: 'migration', name, config: { ...config, phase } };
}

export function defineInterfaceEntry(
	name: string,
	config: InterfaceConfig,
): InterfaceEntry {
	return { type: 'interface', name, config };
}

export function defineDisplayEntry(
	name: string,
	config: DisplayConfig,
): DisplayEntry {
	return { type: 'display', name, config };
}

export function defineLayoutEntry<Options = any, Query = any>(
	name: string,
	config: LayoutConfig<Options, Query>,
): LayoutEntry {
	return { type: 'layout', name, config: config as LayoutConfig };
}

export function defineModuleEntry(name: string, config: ModuleConfig): ModuleEntry {
	return { type: 'module', name, config };
}

export function definePanelEntry(name: string, config: PanelConfig): PanelEntry {
	return { type: 'panel', name, config };
}

export function defineThemeEntry(name: string, config: Theme): ThemeEntry {
	return { type: 'theme', name, config };
}

export function defineOperationAppEntry(
	name: string,
	config: OperationAppConfig,
): OperationAppEntry {
	return { type: 'operation', name, config };
}

function refuseRepeatedNames(entries: { name: string }[]): void {
	const seenNames = new Set<string>();

	for (const { name } of entries) {
		if (seenNames.has(name)) {
			throw new Error(`Bundle entries repeat the name ${JSON.stringify(name)}`);
		}

		seenNames.add(name);
	}
}

export function defineBundleApi(
	entries: BundleApiEntry[],
): BundleEntries<BundleApiEntry> {
	refuseRepeatedNames(entries);

	return { format: BUNDLE_ENTRIES_FORMAT, entries };
}

export function defineBundleApp(
	entries: BundleAppEntry[],
): BundleEntries<BundleAppEntry> {
	refuseRepeatedNames(entries);

	return { format: BUNDLE_ENTRIES_FORMAT, entries };
}
