import type { PrimaryKey } from '@directus/types';

/**
 * Whether a value is usable as a primary key.
 *
 * A value read out of a payload by a runtime field name is `any` as far as the
 * compiler knows, so this is what gets it to `PrimaryKey` by proof rather than
 * by assertion. Whether it is the *right* kind of key for its collection — a
 * uuid where the schema says uuid, an integer where it says integer — is
 * `validateKeys`, which takes it from here.
 */
export function isPrimaryKey(value: unknown): value is PrimaryKey {
	return typeof value === 'string' || typeof value === 'number';
}
