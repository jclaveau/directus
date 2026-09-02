import { parseJSON } from '@directus/utils';
import type { Knex } from 'knex';
import { useLogger } from '../../logger/index.js';
import type { MigrationTransactionScope } from '../../types/index.js';

/**
 * Runs unwrapped: it updates each field row on its own, logging and
 * continuing when one will not take.
 * Postgres aborts a whole transaction on any error, so inside the run's those
 * catches would stop protecting anything and merely hide the abort until a
 * later statement failed. The paths only fire on an upgrade, which no test
 * here reaches, so this keeps the migration exactly as it has always run
 * rather than rewriting logic that cannot be exercised.
 */
export const transactionScope: MigrationTransactionScope = 'none';

export async function up(knex: Knex): Promise<void> {
	const logger = useLogger();

	const dividerGroups = await knex.select('*').from('directus_fields').where('interface', '=', 'group-divider');

	for (const dividerGroup of dividerGroups) {
		const newOptions: { showHeader: true; headerIcon?: string; headerColor?: string } = { showHeader: true };

		if (dividerGroup.options) {
			try {
				const options =
					typeof dividerGroup.options === 'string' ? parseJSON(dividerGroup.options) : dividerGroup.options;

				if (options.icon) newOptions.headerIcon = options.icon;
				if (options.color) newOptions.headerColor = options.color;
			} catch (err: any) {
				logger.warn(`Couldn't convert previous options from field ${dividerGroup.collection}.${dividerGroup.field}`);
				logger.warn(err);
			}
		}

		try {
			await knex('directus_fields')
				.update({
					interface: 'group-standard',
					options: JSON.stringify(newOptions),
				})
				.where('id', '=', dividerGroup.id);
		} catch (err: any) {
			logger.warn(`Couldn't update ${dividerGroup.collection}.${dividerGroup.field} to new group interface`);
			logger.warn(err);
		}
	}

	await knex('directus_fields')
		.update({
			interface: 'group-standard',
		})
		.where({ interface: 'group-raw' });
}

export async function down(knex: Knex): Promise<void> {
	await knex('directus_fields')
		.update({
			interface: 'group-raw',
		})
		.where('interface', '=', 'group-standard');
}
