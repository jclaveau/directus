import type { PrimaryKey } from '@directus/types';

export function isPrimaryKey(it: unknown): it is PrimaryKey {
	return typeof it === 'number' || typeof it === 'string';
}

export function isNotPrimaryKey<T>(it: T): it is T extends PrimaryKey ? never : T {
	return !isPrimaryKey(it);
}
