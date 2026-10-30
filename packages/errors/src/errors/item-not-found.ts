import { createError, ErrorCode } from '../index.js';

export interface ItemNotFoundErrorExtensions {
	collection: string;
	primaryKey: string | number;
}

export const messageConstructor = ({
	collection,
	primaryKey,
}: ItemNotFoundErrorExtensions) => {
	return `Item "${primaryKey}" doesn't exist in collection "${collection}".`;
};

/**
 * Only an admin is told an item is missing: anyone else gets a 403 for it, so
 * a key's existence never leaks past the permissions that hide it.
 */
export const ItemNotFoundError = createError<ItemNotFoundErrorExtensions>(
	ErrorCode.ItemNotFound,
	messageConstructor,
	404,
);
