import { createError, ErrorCode } from '../index.js';

// `invalid_reference`: a write named a parent row that doesn't exist (insert/update
// a child with a bad FK). `still_referenced`: a parent row can't be deleted/updated
// because a child still references it (RESTRICT/NO ACTION) — the opposite direction.
export type ForeignKeyViolationReason = 'invalid_reference' | 'still_referenced';

export interface InvalidForeignKeyErrorExtensions {
	collection: string | null;
	field: string | null;
	value: string | null;
	// The FK constraint name and the other table in the relationship (the referenced
	// parent for `invalid_reference`, the referencing child for `still_referenced`),
	// plus which direction the violation is — all optional since not every dialect
	// exposes them.
	constraint?: string | null;
	relatedCollection?: string | null;
	reason?: ForeignKeyViolationReason | null;
}

export const messageConstructor = (extensions: InvalidForeignKeyErrorExtensions) => {
	const { collection, field, value, relatedCollection, reason } = extensions;

	if (reason === 'still_referenced') {
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

	if (value) {
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
