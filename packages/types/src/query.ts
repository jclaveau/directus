import type { Filter } from './filter.js';

export type Query = {
	fields?: string[] | null;
	sort?: string[] | null;
	filter?: Filter | null;
	limit?: number | null;
	offset?: number | null;
	page?: number | null;
	search?: string | null;
	version?: string | null;
	versionRaw?: boolean | null;
	export?: 'json' | 'csv' | 'xml' | null;
	group?: string[] | null;
	aggregate?: Aggregate | null;
	deep?: NestedDeepQuery | null;
	alias?: Record<string, string> | null;
	backlink?: boolean;
	// Which counts the response reports (`total_count`, `filter_count`). Set by
	// `sanitizeQuery` and read by the responder, both of which had to cast around its
	// absence — and one of those reads decides whether a cached response depends on
	// rows its filter never bounded, which is too load-bearing to leave untyped.
	// A plain `string[]`: an unrecognised `meta=` value reaches this list unchanged.
	meta?: string[];
};

export type DeepQuery = {
	_fields?: string[] | null;
	_sort?: string[] | null;
	_filter?: Filter | null;
	_limit?: number | null;
	_offset?: number | null;
	_page?: number | null;
	_search?: string | null;
	_group?: string[] | null;
	_aggregate?: Aggregate | null;
};

export type NestedDeepQuery = { [field: string]: DeepQuery | NestedDeepQuery };

/**
 * Aggregate operation. Contains column name, and the field alias it should be returned as
 */
export type Aggregate = {
	avg?: string[];
	avgDistinct?: string[];
	count?: string[];
	countDistinct?: string[];
	sum?: string[];
	sumDistinct?: string[];
	min?: string[];
	max?: string[];
	countAll?: string[];
};
