import type {
	ScopedCachePath,
	SchemaOverview,
} from '@directus/types';
import {
	composeScopedCachePaths,
	resolveScopedCacheM2oJoinChainFromPath,
	type FieldTypesByField,
	type ScopedCacheM2oJoin,
} from '../scoped-cache.js';

/**
 * Stateless read-side metadata for a collection's scoped cache. Derives the flat
 * fields, dotted paths, terminal types and related primary keys the snapshot and
 * read-tag assembly consume. Every member is a pure function of (collection,
 * schema), both fixed for the owning ItemsService, so the getters can memoize later.
 */
export class ItemScopedCacheService {
	private collection: string;
	private schema: SchemaOverview;

	constructor(collection: string, schema: SchemaOverview) {
		this.collection = collection;
		this.schema = schema;
	}

	get fields(): string[] {
		return this.schema.collections[this.collection]?.scopedCacheFields ?? [];
	}

	// Direct-column scope fields (no dot): they project into the snapshot SELECT and
	// feed the pinner's flat + one-hop logic. Dotted paths are handled separately.
	get flatFields(): string[] {
		return this.fields.filter((field) => !field.includes('.'));
	}

	// The multi-hop paths this collection pins by: explicit dotted entries PLUS paths
	// auto-derived from local scope fields (see `composeScopedCachePaths`). Each is
	// re-resolved so a to-many/unknown hop drops it → bare tag both sides. Deduped.
	get paths(): ScopedCachePath[] {
		const byField = new Map<string, ScopedCachePath>();

		const addPath = (field: string) => {
			if (byField.has(field)) {
				return;
			}

			const resolved = this.resolvePath(field);

			if (resolved) {
				byField.set(field, { field, segments: resolved.segments });
			}
		};

		for (const field of this.fields) {
			if (field.includes('.')) {
				addPath(field);
			}
		}

		for (const { field } of composeScopedCachePaths(this.schema, this.collection)) {
			addPath(field);
		}

		return [...byField.values()];
	}

	// Resolve a dotted scope field into the M2O join chain reaching its terminal.
	// Every INTERMEDIATE segment must be M2O (a row maps to exactly one parent); a
	// to-many hop or unknown field returns null → the caller degrades to the bare
	// tag. The terminal is a plain column on the last collection (scalar or fk).
	resolvePath(path: string): {
		segments: string[];
		joins: ScopedCacheM2oJoin[];
		terminalCollection: string;
		terminalField: string;
	} | null {
		const segments = path.split('.');

		if (segments.length < 2) {
			return null;
		}

		const joins = resolveScopedCacheM2oJoinChainFromPath(
			this.schema,
			this.collection,
			segments.slice(0, -1),
		);

		if (joins === null) {
			return null;
		}

		return {
			segments,
			joins,
			// At least one hop, since a path shorter than two segments returned above.
			terminalCollection: joins[joins.length - 1]!.relatedCollection,
			terminalField: segments[segments.length - 1]!,
		};
	}

	get fieldTypes(): FieldTypesByField {
		const rootFields = this.schema.collections[this.collection]?.fields ?? {};
		const types: FieldTypesByField = {};

		// The primary key pins implicitly on every collection, so its type travels with
		// the declared ones — both sides canonicalize the key the same way.
		const primaryKeyField = this.schema.collections[this.collection]?.primary;

		if (primaryKeyField !== undefined) {
			types[primaryKeyField] = rootFields[primaryKeyField]?.type;
		}

		for (const field of this.flatFields) {
			types[field] = rootFields[field]?.type;
		}

		for (const { field } of this.paths) {
			const resolved = this.resolvePath(field);

			if (!resolved) {
				continue;
			}

			const terminal = this.schema.collections[resolved.terminalCollection];
			types[field] = terminal?.fields[resolved.terminalField]?.type;
		}

		return types;
	}

	// A scope field's related primary key, so the read side can unwrap the
	// `{ fk: { <pk>: { _eq } } }` shape queries/permissions use — for a flat one-hop
	// relation, and for a path whose terminal is itself an M2O (`{ user: { id } }`).
	get relatedPks(): Record<string, string> {
		const map: Record<string, string> = {};

		const addRelatedPk = (
			field: string,
			fromCollection: string,
			fromField: string,
		) => {
			const relation = this.schema.relations.find((rel) => {
				return rel.collection === fromCollection && rel.field === fromField;
			});

			const relatedCollection = relation?.related_collection;

			const primaryKey = relatedCollection
				? this.schema.collections[relatedCollection]?.primary
				: undefined;

			if (primaryKey) {
				map[field] = primaryKey;
			}
		};

		for (const field of this.flatFields) {
			addRelatedPk(field, this.collection, field);
		}

		for (const { field } of this.paths) {
			const resolved = this.resolvePath(field);

			if (resolved) {
				addRelatedPk(field, resolved.terminalCollection, resolved.terminalField);
			}
		}

		return map;
	}
}
