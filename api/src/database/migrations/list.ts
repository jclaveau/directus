import { useEnv } from '@directus/env';
import type { MigrationConfig, MigrationPhase } from '@directus/extensions/scalabus';
import formatTitle from '@directus/format-title';
import fse from 'fs-extra';
import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import getModuleDefault from '../../utils/get-module-default.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type MigrationModule = Pick<
	MigrationConfig,
	'up' | 'down' | 'transactionScope'
>;

/** A `defineMigration` of an installed bundle. */
export interface ExtensionMigration {
	bundle: string;
	name: string;
	config: MigrationConfig;
}

export interface ListedMigration {
	version: string;
	name: string;
	/** What a log or a collision names: the file, or the bundle and its entry. */
	file: string;
	bundle: string | null;
	phase: MigrationPhase;
	loadModule: () => Promise<MigrationModule>;
}

const CORE_FILE_PATTERN = /^[0-9]+[A-Z]-[^.]+\.(?:js|ts)$/;

function readDate(version: string): string {
	return (version.match(/^\d+/)?.[0] ?? '').padStart(16, '0');
}

/**
 * A migration targets the schema the fork had on its date, so the order is by
 * date first; on the same date the core runs before the extensions, which run
 * bundle by bundle.
 */
function compareMigrations(left: ListedMigration, right: ListedMigration): number {
	const leftKey = [
		readDate(left.version.split(':').at(-1)!),
		left.bundle === null
			? '0'
			: '1',
		left.bundle ?? '',
		left.version,
	];

	const rightKey = [
		readDate(right.version.split(':').at(-1)!),
		right.bundle === null
			? '0'
			: '1',
		right.bundle ?? '',
		right.version,
	];

	for (const [index, leftPart] of leftKey.entries()) {
		const rightPart = rightKey[index]!;

		if (leftPart !== rightPart) {
			return leftPart < rightPart
				? -1
				: 1;
		}
	}

	return 0;
}

function listFileMigration(directory: string, fileName: string): ListedMigration {
	const file = path.join(directory, fileName);

	return {
		version: fileName.split('-')[0]!,
		name: formatTitle(fileName.split('-').slice(1)
			.join('_')
			.split('.')[0]!),
		file,
		bundle: null,
		phase: 'before-schema',
		loadModule: async () => getModuleDefault<MigrationModule>(await import(`file://${file}`)),
	};
}

function listExtensionMigration({
	bundle,
	name,
	config,
}: ExtensionMigration): ListedMigration {
	return {
		version: `${bundle}:${name.split('-')[0]}`,
		name: formatTitle(name.split('-').slice(1)
			.join('_')),
		file: `${bundle} entry ${JSON.stringify(name)}`,
		bundle,
		phase: config.phase ?? 'before-schema',
		loadModule: async () => config,
	};
}

function refuseCollisions(migrations: ListedMigration[]): void {
	const filesByVersion = new Map<string, string[]>();

	for (const migration of migrations) {
		const files = filesByVersion.get(migration.version) ?? [];
		files.push(migration.file);
		filesByVersion.set(migration.version, files);
	}

	const collisions = [...filesByVersion]
		.filter(([, files]) => files.length > 1)
		.map(([version, files]) => `\t- "${version}": ${files.join(', ')}`)
		.join('\n');

	if (collisions.length > 0) {
		throw new Error(
			'Migration keys collide! Please ensure that every migration uses a '
			+ `unique key:\n${collisions}`,
		);
	}
}

/**
 * Every migration this build runs, in the order it runs them: the core's,
 * `MIGRATIONS_PATH`'s and the installed bundles' `defineMigration`s.
 */
export async function listMigrations(
	extensionMigrations: ExtensionMigration[] = [],
): Promise<ListedMigration[]> {
	const env = useEnv();

	const coreFiles = (await fse.readdir(__dirname)).filter(
		(file: string) => CORE_FILE_PATTERN.test(file),
	);

	const customMigrationsPath = path.resolve(env['MIGRATIONS_PATH'] as string);

	const customFiles = (
		(
			(await fse.pathExists(customMigrationsPath))
			&& (await fse.readdir(customMigrationsPath))
		) ||
		[]
	).filter((file: string) => file.includes('-') && /\.(c|m)?js$/.test(file));

	const undatedFile = customFiles.find((file) => !/^\d{8}[A-Z]-/.test(file));

	if (undatedFile !== undefined) {
		throw new Error(
			`Migration ${JSON.stringify(undatedFile)} in MIGRATIONS_PATH has no date:`
				+ ' name it "<YYYYMMDD><letter>-<name>.js"',
		);
	}

	const migrations = [
		...coreFiles.map((file) => listFileMigration(__dirname, file)),
		...customFiles.map((file) => listFileMigration(customMigrationsPath, file)),
		...extensionMigrations.map(listExtensionMigration),
	].sort(compareMigrations);

	refuseCollisions(migrations);

	return migrations;
}
