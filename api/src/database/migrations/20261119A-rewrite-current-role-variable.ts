import type { Knex } from 'knex';

/**
 * `$CURRENT_ROLE` is removed (#746): a user can hold several roles, so there is
 * no one role to name. Every stored `{"_eq": "$CURRENT_ROLE"}` becomes
 * `{"_in": "$CURRENT_MEMBER_ROLES"}` and `_neq` becomes `_nin`, which match the
 * same rows for a user holding one role. Any other use, such as a preset value
 * or `$CURRENT_ROLE.name`, has no such rewrite: the migration refuses and names
 * every row holding one.
 */

// Self-contained on purpose: a migration must not move when runtime code does.
const ROLE_VARIABLE_COLUMNS: Record<string, string[]> = {
	directus_permissions: ['permissions', 'validation', 'presets'],
	directus_presets: ['filter'],
	directus_fields: ['options', 'conditions', 'validation'],
	directus_operations: ['options'],
	directus_panels: ['options'],
};

const REMOVED_VARIABLE = '$CURRENT_ROLE';

const MEMBER_ROLES_VARIABLE = '$CURRENT_MEMBER_ROLES';

const REWRITTEN_OPERATORS: Record<string, string> = {
	_eq: '_in',
	_neq: '_nin',
};

const RESTORED_OPERATORS: Record<string, string> = {
	_in: '_eq',
	_nin: '_neq',
};

type StoredValue = {
	table: string;
	id: string | number;
	column: string;
	value: unknown;
};

function swapOperators(
	value: unknown,
	operatorSwaps: Record<string, string>,
	fromVariable: string,
	toVariable: string,
): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => {
			return swapOperators(item, operatorSwaps, fromVariable, toVariable);
		});
	}

	if (value === null || typeof value !== 'object') {
		return value;
	}

	const entries = Object.entries(value);

	const [onlyOperator, onlyOperand] = entries.length === 1
		? entries[0]!
		: [];

	if (
		onlyOperator !== undefined
		&& onlyOperator in operatorSwaps
		&& onlyOperand === fromVariable
	) {
		return { [operatorSwaps[onlyOperator]!]: toVariable };
	}

	return Object.fromEntries(entries.map(([key, nestedValue]) => {
		return [
			key,
			swapOperators(nestedValue, operatorSwaps, fromVariable, toVariable),
		];
	}));
}

export function rewriteCurrentRole(value: unknown) {
	return swapOperators(
		value,
		REWRITTEN_OPERATORS,
		REMOVED_VARIABLE,
		MEMBER_ROLES_VARIABLE,
	);
}

export function restoreCurrentRole(value: unknown) {
	return swapOperators(
		value,
		RESTORED_OPERATORS,
		MEMBER_ROLES_VARIABLE,
		REMOVED_VARIABLE,
	);
}

export function findCurrentRole(value: unknown): string | null {
	if (typeof value === 'string') {
		const isRemovedVariable = value === REMOVED_VARIABLE
			|| value.startsWith(`${REMOVED_VARIABLE}.`);

		return isRemovedVariable
			? value
			: null;
	}

	if (value === null || typeof value !== 'object') {
		return null;
	}

	for (const nestedValue of Object.values(value)) {
		const removedVariable = findCurrentRole(nestedValue);

		if (removedVariable !== null) {
			return removedVariable;
		}
	}

	return null;
}

// A JSON column reads as text outside Postgres.
function parsedColumnValue(columnValue: unknown) {
	if (typeof columnValue !== 'string') {
		return columnValue;
	}

	try {
		return JSON.parse(columnValue);
	}
	catch {
		return columnValue;
	}
}

async function readStoredValues(knex: Knex) {
	const storedValues: StoredValue[] = [];

	for (const [table, columns] of Object.entries(ROLE_VARIABLE_COLUMNS)) {
		const rows = await knex.select('id', ...columns).from(table);

		for (const row of rows) {
			for (const column of columns) {
				if (row[column] === null || row[column] === undefined) {
					continue;
				}

				storedValues.push({
					table,
					id: row.id,
					column,
					value: parsedColumnValue(row[column]),
				});
			}
		}
	}

	return storedValues;
}

async function writeChangedValues(
	knex: Knex,
	storedValues: StoredValue[],
	changeValue: (value: unknown) => unknown,
) {
	for (const { table, id, column, value } of storedValues) {
		const changedValue = changeValue(value);

		if (JSON.stringify(changedValue) === JSON.stringify(value)) {
			continue;
		}

		await knex(table)
			.update({ [column]: JSON.stringify(changedValue) })
			.where({ id });
	}
}

export async function up(knex: Knex): Promise<void> {
	const storedValues = await readStoredValues(knex);

	const unrewritableValues = storedValues.flatMap((storedValue) => {
		const removedVariable = findCurrentRole(rewriteCurrentRole(storedValue.value));

		return removedVariable === null
			? []
			: [
				`${storedValue.table} ${JSON.stringify(storedValue.id)}`
				+ ` ${JSON.stringify(storedValue.column)}`
				+ ` uses ${JSON.stringify(removedVariable)}`,
			];
	});

	if (unrewritableValues.length > 0) {
		throw new Error(
			'"$CURRENT_ROLE" is removed (a user can hold several roles) and these'
			+ ' values have no "$CURRENT_MEMBER_ROLES" rewrite:'
			+ ` ${unrewritableValues.join('; ')}.`
			+ ' Replace each by hand, then run the migration again.',
		);
	}

	await writeChangedValues(knex, storedValues, rewriteCurrentRole);
}

export async function down(knex: Knex): Promise<void> {
	await writeChangedValues(
		knex,
		await readStoredValues(knex),
		restoreCurrentRole,
	);
}
