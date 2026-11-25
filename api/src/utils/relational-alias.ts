import { toArray } from '@directus/utils';

export const RELATIONAL_ALIAS_SPECIALS = [
	'o2m',
	'm2m',
	'm2a',
	'translations',
	'files',
] as const;

type RelationalAliasSpecial = typeof RELATIONAL_ALIAS_SPECIALS[number];

/**
 * The relational special a `directus_fields` row carries, as the CSV text the
 * table stores or as the array the API takes.
 */
export function findRelationalSpecial(
	fieldSpecial: string | string[] | null | undefined,
): RelationalAliasSpecial | undefined {
	if (fieldSpecial === null || fieldSpecial === undefined) {
		return undefined;
	}

	const fieldSpecials: string[] = toArray(fieldSpecial);

	return RELATIONAL_ALIAS_SPECIALS.find((relationalSpecial) => {
		return fieldSpecials.includes(relationalSpecial);
	});
}

export function unnamedRelationalAliasReason(
	collection: string,
	field: string,
	relationalSpecial: RelationalAliasSpecial,
) {
	const specialArticle = ['translations', 'files'].includes(relationalSpecial)
		? 'a'
		: 'an';

	return `Field ${JSON.stringify(field)} of ${JSON.stringify(collection)}`
		+ ` is ${specialArticle} ${relationalSpecial} alias no relation names`
		+ ' in one_field';
}
