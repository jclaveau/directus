import type { Knex } from 'knex';

const ROLE_TEMPLATE_PATTERN = /\{\{\s*role\.(\w+)\s*\}\}/g;
const FIRST_ROLE_TEMPLATE_PATTERN = /\{\{\s*roles\[0\]\.(\w+)\s*\}\}/g;
const ROLES_TEMPLATE_PATTERN = /\{\{\s*roles\b[^}]*\}\}/g;

/**
 * A user holds several roles (#746): the `report_error_url` template reads
 * `roles`, no more `role`. `up` points each `{{role.<field>}}` at the first
 * member role; `down` points `{{roles[0].<field>}}` back at the role, and
 * refuses, changing nothing, while a template reads `roles` another way.
 * {{role.name}} ↔ {{roles[0].name}}
 */
export async function up(knex: Knex): Promise<void> {
	for (const { id, report_error_url } of await readTemplates(knex)) {
		const rewrittenUrl = report_error_url
			.replaceAll(ROLE_TEMPLATE_PATTERN, '{{roles[0].$1}}');

		if (rewrittenUrl !== report_error_url) {
			await knex('directus_settings')
				.update({ report_error_url: rewrittenUrl })
				.where({ id });
		}
	}
}

export async function down(knex: Knex): Promise<void> {
	const restoredTemplates = (await readTemplates(knex)).map((template) => {
		return {
			...template,
			restoredUrl: template.report_error_url
				.replaceAll(FIRST_ROLE_TEMPLATE_PATTERN, '{{role.$1}}'),
		};
	});

	for (const { id, restoredUrl } of restoredTemplates) {
		const unrestorableReads = restoredUrl.match(ROLES_TEMPLATE_PATTERN);

		if (unrestorableReads) {
			throw new Error(
				'Cannot roll back the multi-role migration: directus_settings row'
				+ ` ${JSON.stringify(id)} "report_error_url" reads`
				+ ` ${unrestorableReads.map((read) => JSON.stringify(read)).join(', ')},`
				+ ' which one role cannot hold; replace them by hand first',
			);
		}
	}

	for (const { id, report_error_url, restoredUrl } of restoredTemplates) {
		if (restoredUrl !== report_error_url) {
			await knex('directus_settings')
				.update({ report_error_url: restoredUrl })
				.where({ id });
		}
	}
}

async function readTemplates(knex: Knex) {
	const settingsRows: { id: number; report_error_url: string | null }[]
		= await knex.select('id', 'report_error_url').from('directus_settings');

	return settingsRows.filter((settingsRow) => {
		return settingsRow.report_error_url !== null;
	}) as { id: number; report_error_url: string }[];
}
