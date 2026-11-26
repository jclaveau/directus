import { defineMigration } from '@directus/extensions-sdk/scalabus';
import type { Knex } from 'knex';

export const EXAMPLES_MODULE_ID = 'subscriptions-examples';

type ModuleBarEntry = { type: string; id: string; enabled: boolean };

/**
 * The app's `MODULE_BAR_DEFAULT`, which it shows while `module_bar` is null:
 * the bar a fresh instance shows before the examples join it.
 */
const DEFAULT_MODULE_BAR = [
	{ type: 'module', id: 'content', enabled: true },
	{ type: 'module', id: 'visual', enabled: false },
	{ type: 'module', id: 'users', enabled: true },
	{ type: 'module', id: 'files', enabled: true },
	{ type: 'module', id: 'insights', enabled: true },
	{
		type: 'link',
		id: 'docs',
		enabled: true,
		name: '$t:documentation',
		icon: 'help',
		url: 'https://docs.directus.io',
	},
	{ type: 'module', id: 'settings', enabled: true, locked: true },
];

/**
 * The app routes every module but lists in its bar only those `module_bar`
 * names: the examples module is added there, before Settings.
 */
export const showExamplesModule = defineMigration(
	'20261123A-show-examples-module',
	{
		async up(knex) {
			const storedBar = await readModuleBar(knex);

			if (storedBar.some((barEntry) => barEntry.id === EXAMPLES_MODULE_ID)) {
				return;
			}

			const settingsIndex = storedBar.findIndex((barEntry) => {
				return barEntry.id === 'settings';
			});

			const examplesEntry = {
				type: 'module',
				id: EXAMPLES_MODULE_ID,
				enabled: true,
			};

			await writeModuleBar(knex, settingsIndex === -1
				? [...storedBar, examplesEntry]
				: [
					...storedBar.slice(0, settingsIndex),
					examplesEntry,
					...storedBar.slice(settingsIndex),
				]);
		},

		async down(knex) {
			const storedBar = await readModuleBar(knex);

			await writeModuleBar(knex, storedBar.filter((barEntry) => {
				return barEntry.id !== EXAMPLES_MODULE_ID;
			}));
		},
	},
);

async function readModuleBar(knex: Knex): Promise<ModuleBarEntry[]> {
	const settingsRow = await knex('directus_settings')
		.select('module_bar')
		.first();

	const storedBar = settingsRow?.module_bar ?? null;

	if (storedBar === null) {
		return DEFAULT_MODULE_BAR;
	}

	return typeof storedBar === 'string'
		? JSON.parse(storedBar)
		: storedBar;
}

async function writeModuleBar(
	knex: Knex,
	moduleBar: ModuleBarEntry[],
): Promise<void> {
	const settingsRow = await knex('directus_settings')
		.select('id')
		.first();

	if (settingsRow === undefined) {
		await knex('directus_settings')
			.insert({ module_bar: JSON.stringify(moduleBar) });

		return;
	}

	await knex('directus_settings')
		.update({ module_bar: JSON.stringify(moduleBar) })
		.where('id', settingsRow.id);
}
