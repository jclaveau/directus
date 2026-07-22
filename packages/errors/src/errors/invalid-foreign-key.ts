import { createError, ErrorCode } from '../index.js';

// `invalid_reference`: a write named a parent row that doesn't exist (insert/update
// a child with a bad FK). `still_referenced`: a parent row can't be deleted/updated
// because a child still references it (RESTRICT/NO ACTION) — the opposite direction.
export type ForeignKeyViolationReason = 'invalid_reference' | 'still_referenced';

export type ForeignKeyViolationOperation = 'create' | 'update' | 'delete';

export interface InvalidForeignKeyErrorExtensions {
	collection: string | null;
	field: string | null;
	value: string | null;
	// The FK constraint name and the other table in the relationship (the referenced
	// parent for `invalid_reference`, the referencing child for `still_referenced`),
	// the direction, and the operation the caller attempted — all optional since not
	// every dialect exposes them and the operation is only known at the call site.
	constraint?: string | null;
	relatedCollection?: string | null;
	reason?: ForeignKeyViolationReason | null;
	operation?: ForeignKeyViolationOperation | null;
}

export const messageConstructor = (extensions: InvalidForeignKeyErrorExtensions) => {
	const { collection, field, value, relatedCollection, reason, operation } =
		extensions;

	if (reason === 'still_referenced') {
		// The operation is known only at the call site; when it's a delete or an
		// update, name it so the message points straight at what failed. Otherwise
		// (the read path) stay operation-agnostic.
		if (operation === 'delete' || operation === 'update') {
			let message = `Cannot ${operation}`;

			// Name the exact row (`collection:pk`) when the driver gave us a single
			// key value (pg does). Skip a composite key (comma in the field) since
			// `collection:1, 2` reads wrong, and fall back to the collection.
			const hasSingleKey =
				value != null && !!field && !field.includes(',');

			if (collection && hasSingleKey) {
				message += ` "${collection}:${value}"`;
			}
			else if (collection) {
				message += ` collection "${collection}"`;
			}

			message += ': it is still referenced';

			if (relatedCollection) {
				message += ` by collection "${relatedCollection}"`;
			}

			return `${message}.`;
		}

		let message = 'Record';

		if (collection) {
			message += ` in collection "${collection}"`;
		}

		message += ' is still referenced';

		if (relatedCollection) {
			message += ` by collection "${relatedCollection}"`;
		}

		return `${message}.`;
	}

	let message = 'Invalid foreign key';

	if (value != null && value !== '') {
		message += ` "${value}"`;
	}

	if (field) {
		message += ` for field "${field}"`;
	}

	if (collection) {
		message += ` in collection "${collection}"`;
	}

	if (relatedCollection) {
		message += ` (references "${relatedCollection}")`;
	}

	return `${message}.`;
};

export const InvalidForeignKeyError = createError<InvalidForeignKeyErrorExtensions>(
	ErrorCode.InvalidForeignKey,
	messageConstructor,
	400,
);
