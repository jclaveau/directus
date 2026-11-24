import { createInspector } from '@directus/schema';
import type { Knex } from 'knex';
import { useLogger } from '../../logger/index.js';
import { getDatabaseClient } from '../index.js';

const RENAMED_SPECIALS = new Map([
	['role-created', 'roles-created'],
	['role-updated', 'roles-updated'],
]);

const FORMER_SPECIALS = new Map(
	[...RENAMED_SPECIALS].map(([former, renamed]) => [renamed, former]),
);

interface StampFieldRow {
	id: number;
	collection: string;
	field: string;
	special: string;
}

async function readStampFields(
	knex: Knex,
	specialNames: string[],
): Promise<StampFieldRow[]> { // bb-unit-only: bb migrates an empty database
	const fieldRows: StampFieldRow[] = await knex
		.select('id', 'collection', 'field', 'special')
		.from('directus_fields')
		.whereNotNull('special')
		.orderBy('id');

	return fieldRows.filter(({ special }) => {
		return special.split(',').some((name) => specialNames.includes(name));
	});
}

function namedFields(fieldRows: StampFieldRow[]) { // bb-unit-only: bb migrates an empty database
	return fieldRows
		.map(({ collection, field }) => {
			return `${JSON.stringify(collection)}.${JSON.stringify(field)}`;
		})
		.join(', ');
}

// TODO(#610): sqlite, mariadb and cockroachdb need their own column rewrite.
function refuseNonPostgres(knex: Knex, fieldRows: StampFieldRow[]) { // bb-unit-only: bb migrates an empty database
	const databaseClient = getDatabaseClient(knex);

	if (databaseClient !== 'postgres') { // bb-out-of-scope: #610 non-Postgres
		throw new Error(
			`The role stamp fields ${namedFields(fieldRows)} can only be`
			+ ` converted on postgres, not on ${JSON.stringify(databaseClient)}`,
		);
	}
}

/**
 * A user holds several roles (#746): `role-created` / `role-updated` become
 * `roles-created` / `roles-updated`, stamping a json list of the member roles
 * that allowed the write. Each stored role uuid becomes a list of that one
 * role, and the field stops being a relation to `directus_roles`.
 */
export async function up(knex: Knex): Promise<void> { // bb-unit-only: bb migrates an empty database
	const fieldRows = await readStampFields(knex, [...RENAMED_SPECIALS.keys()]);

	if (fieldRows.length === 0) {
		return;
	}

	refuseNonPostgres(knex, fieldRows);

	const inspector = createInspector(knex);

	for (const { id, collection, field, special } of fieldRows) {
		// An instance upgraded from an old release may hold the constraint under
		// another name than knex's default.
		const roleForeignKey = (await inspector.foreignKeys(collection))
			.find(({ column }) => column === field);

		if (roleForeignKey) {
			await knex.schema.alterTable(collection, (table) => {
				table.dropForeign([field], roleForeignKey.constraint_name ?? undefined);
			});
		}

		await knex.raw(
			'alter table ?? alter column ?? type json using case when ?? is null'
			+ ' then null else json_build_array(??) end',
			[collection, field, field, field],
		);

		await knex('directus_relations')
			.delete()
			.where({ many_collection: collection, many_field: field });

		const renamedSpecials = special.split(',')
			.map((name) => RENAMED_SPECIALS.get(name) ?? name);

		if (!renamedSpecials.includes('cast-json')) {
			renamedSpecials.push('cast-json');
		}

		// The m2o picker cannot show a json list: tags edit it, labels show it.
		await knex('directus_fields')
			.update({
				special: renamedSpecials.join(','),
				interface: 'tags',
				options: null,
				display: 'labels',
				display_options: null,
			})
			.where({ id });
	}

	useLogger().info(
		`Turned the role stamp fields ${namedFields(fieldRows)} into json lists`
		+ ' of member roles, dropping their relation to "directus_roles"',
	);
}

/**
 * Back to one role uuid, related to `directus_roles` again. Refused, changing
 * nothing, while a stamp lists several roles: one uuid cannot hold them.
 */
export async function down(knex: Knex): Promise<void> { // bb-unit-only: bb never migrates down
	const fieldRows = await readStampFields(knex, [...FORMER_SPECIALS.keys()]);

	if (fieldRows.length === 0) {
		return;
	}

	refuseNonPostgres(knex, fieldRows);

	const inspector = createInspector(knex);
	const severalRoleStamps: string[] = [];

	for (const { collection, field } of fieldRows) {
		const primaryKeyField = await inspector.primary(collection);

		if (primaryKeyField === null) {
			throw new Error(
				`Cannot roll back the role stamp ${JSON.stringify(collection)}.`
				+ `${JSON.stringify(field)}: its table has no primary key to name`
				+ ' the rows listing several roles',
			);
		}

		const severalRoleRows: Record<string, unknown>[] = await knex
			.select(primaryKeyField)
			.from(collection)
			.whereRaw('json_array_length(??) > 1', [field])
			.orderBy(primaryKeyField);

		if (severalRoleRows.length > 0) {
			const rowKeys = severalRoleRows
				.map((severalRoleRow) => {
					return JSON.stringify(severalRoleRow[primaryKeyField]);
				})
				.join(', ');

			severalRoleStamps.push(
				`${JSON.stringify(collection)}.${JSON.stringify(field)} rows ${rowKeys}`,
			);
		}
	}

	if (severalRoleStamps.length > 0) {
		throw new Error(
			'Cannot roll back the multi-role migration: role stamps list several'
			+ ` roles in ${severalRoleStamps.join(' and ')}; back up and keep one`
			+ ' role per stamp first',
		);
	}

	for (const { id, collection, field, special } of fieldRows) {
		await knex.raw(
			'alter table ?? alter column ?? type uuid using (?? ->> 0)::uuid',
			[collection, field, field],
		);

		await knex.schema.alterTable(collection, (table) => {
			table.foreign(field)
				.references('directus_roles.id')
				.onDelete('SET NULL');
		});

		await knex('directus_relations').insert({
			many_collection: collection,
			many_field: field,
			one_collection: 'directus_roles',
		});

		const formerFieldSpecials = special.split(',')
			.filter((name) => name !== 'cast-json')
			.map((name) => FORMER_SPECIALS.get(name) ?? name);

		await knex('directus_fields')
			.update({
				special: formerFieldSpecials.join(','),
				interface: 'select-dropdown-m2o',
				options: null,
				display: 'related-values',
				display_options: null,
			})
			.where({ id });
	}

	useLogger().info(
		`Turned the role stamp fields ${namedFields(fieldRows)} back into one`
		+ ' role uuid related to "directus_roles"',
	);
}
