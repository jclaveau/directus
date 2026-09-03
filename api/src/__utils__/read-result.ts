import type { WithMeta } from '@directus/types';
import { withMeta } from '../utils/read-meta.js';

/**
 * A read result shaped the way a service returns one: the rows with the meta
 * rider attached.
 *
 * Every read method resolves to `WithMeta<T>`, so a mock that resolves a bare
 * array is not standing in for what the real thing produces. This uses the
 * production `withMeta`, so a test gets the same object a read would hand it —
 * `readMeta()` finds the rider on it too.
 */
export function readResult<T extends object>(rows: T): WithMeta<T> {
	return withMeta(rows, { scopedCacheTags: [] });
}
