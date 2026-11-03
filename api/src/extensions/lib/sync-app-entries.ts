import { APP_EXTENSION_TYPES } from '@directus/constants';
import { createError, InvalidPayloadError } from '@directus/errors';
import type {
	AppExtensionType,
	BundleExtension,
	ExtensionSettings,
} from '@directus/types';
import { randomUUID } from 'node:crypto';

export interface ReportedBundleEntries {
	source: 'module' | 'registry';
	folder: string;
	entries: { type: string; name: string }[];
}

export interface AppEntriesChanges {
	createdSettings: ExtensionSettings[];
	removedSettingIds: string[];
	bundleEntries: BundleExtension['entries'];
}

export const AppChunkStaleError = createError(
	'APP_CHUNK_STALE',
	'The app entries were read from an app chunk the server no longer serves',
	409,
);

function isAppExtensionType(type: unknown): type is AppExtensionType {
	return (APP_EXTENSION_TYPES as readonly unknown[]).includes(type);
}

/**
 * Refuses a payload that is not a list of `{source, folder, entries}`, naming
 * the first part that is not.
 */
export function readReportedBundleEntries(
	payload: unknown,
): ReportedBundleEntries[] {
	if (!Array.isArray(payload)) {
		throw new InvalidPayloadError({ reason: '"entries" must be an array' });
	}

	for (const [index, reported] of payload.entries()) {
		const isWellFormed = typeof reported === 'object'
			&& reported !== null
			&& (reported.source === 'module' || reported.source === 'registry')
			&& typeof reported.folder === 'string'
			&& Array.isArray(reported.entries)
			&& reported.entries.every((entry: unknown) => {
				return typeof entry === 'object'
					&& entry !== null
					&& typeof (entry as { type?: unknown }).type === 'string'
					&& typeof (entry as { name?: unknown }).name === 'string';
			});

		if (!isWellFormed) {
			throw new InvalidPayloadError({
				reason: `"entries[${index}]" must be `
					+ '{source, folder, entries: [{type, name}]}',
			});
		}
	}

	return payload;
}

/**
 * The rows the app entries a code bundle's chunk declares need: one per entry
 * the settings lack, and none for an app entry the chunk no longer declares.
 * The api side owns its rows, so an `operation` entry is left to it.
 */
export function diffAppEntries(
	bundle: BundleExtension,
	bundleSettings: ExtensionSettings,
	settings: ExtensionSettings[],
	reportedEntries: { type: string; name: string }[],
): AppEntriesChanges {
	const appEntries = reportedEntries.filter(
		(entry) => isAppExtensionType(entry.type),
	);

	const entrySettings = settings.filter((row) => row.bundle === bundleSettings.id);

	const createdSettings = appEntries
		.filter((entry) => !entrySettings.some((row) => row.folder === entry.name))
		.map((entry) => {
			return {
				id: randomUUID(),
				enabled: bundleSettings.enabled,
				source: bundleSettings.source,
				bundle: bundleSettings.id,
				folder: entry.name,
				type: entry.type,
			};
		});

	const removedSettingIds = entrySettings
		.filter((row) => isAppExtensionType(row.type))
		.filter((row) => !appEntries.some((entry) => entry.name === row.folder))
		.map((row) => row.id);

	const bundleEntries = [
		...bundle.entries.filter((entry) => !isAppExtensionType(entry.type)),
		...appEntries.map((entry) => {
			return { type: entry.type as AppExtensionType, name: entry.name };
		}),
	];

	return { createdSettings, removedSettingIds, bundleEntries };
}
