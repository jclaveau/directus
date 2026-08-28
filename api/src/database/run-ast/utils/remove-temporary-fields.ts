import type { Item, SchemaOverview } from '@directus/types';
import { toArray } from '@directus/utils';
import { cloneDeep, pick } from 'lodash-es';
import type { AST, NestedCollectionNode } from '../../../types/ast.js';
import { applyFunctionToColumnName } from './apply-function-to-column-name.js';

export function removeTemporaryFields(
	schema: SchemaOverview,
	rawItem: Item | Item[],
	ast: AST | NestedCollectionNode,
	primaryKeyField: string,
	parentItem?: Item,
): null | Item | Item[] {
	// One copy for the whole tree, taken at the entry — both recursive calls below
	// pass the item they descend from, so an undefined parentItem is the entry.
	// Copying inside the recursion copied every subtree again per level of nesting
	// (a node at depth d copied d+1 times), which dominated a deep read: 22.4s of a
	// 63s CPU profile under load. The copy is for the caller, whose rows must come
	// back untouched; the walk below reads without writing, so a row reached from
	// several parents answers the same for each of them.
	const rawItems = parentItem === undefined
		? cloneDeep(toArray(rawItem))
		: toArray(rawItem);

	const items: Item[] = [];

	if (ast.type === 'a2o') {
		const fields: Record<string, string[]> = {};
		const nestedCollectionNodes: Record<string, NestedCollectionNode[]> = {};

		for (const relatedCollection of ast.names) {
			if (!fields[relatedCollection]) fields[relatedCollection] = [];
			if (!nestedCollectionNodes[relatedCollection]) nestedCollectionNodes[relatedCollection] = [];

			for (const child of ast.children[relatedCollection]!) {
				if (child.type === 'field' || child.type === 'functionField') {
					fields[relatedCollection]!.push(child.name);
				} else {
					fields[relatedCollection]!.push(child.fieldKey);
					nestedCollectionNodes[relatedCollection]!.push(child);
				}
			}
		}

		for (const rawItem of rawItems) {
			const relatedCollection: string = parentItem?.[ast.relation.meta!.one_collection_field!];

			if (rawItem === null || rawItem === undefined) return rawItem;

			const nestedItems: Item = {};

			for (const nestedNode of nestedCollectionNodes[relatedCollection]!) {
				nestedItems[nestedNode.fieldKey] = removeTemporaryFields(
					schema,
					rawItem[nestedNode.fieldKey],
					nestedNode,
					schema.collections[nestedNode.relation.collection]!.primary,
					rawItem,
				);
			}

			const fieldsWithFunctionsApplied = fields[relatedCollection]!.map((field) => applyFunctionToColumnName(field));

			items.push(
				fields[relatedCollection]!.length > 0
					? { ...pick(rawItem, fieldsWithFunctionsApplied), ...nestedItems }
					: rawItem[primaryKeyField],
			);
		}
	} else {
		const fields: string[] = [];
		const aliasFields: string[] = [];
		const nestedCollectionNodes: NestedCollectionNode[] = [];

		for (const child of ast.children) {
			if ('alias' in child && child.alias === true) {
				aliasFields.push(child.fieldKey);
			} else {
				fields.push(child.fieldKey);
			}

			if (child.type !== 'field' && child.type !== 'functionField') {
				nestedCollectionNodes.push(child);
			}
		}

		// Make sure any requested aggregate fields are included
		if (ast.query?.aggregate) {
			for (const [operation, aggregateFields] of Object.entries(ast.query.aggregate)) {
				if (!fields) continue;

				if (operation === 'count' && aggregateFields.includes('*')) fields.push('count');

				fields.push(...aggregateFields.map((field) => `${operation}.${field}`));
			}
		}

		for (const rawItem of rawItems) {
			if (rawItem === null || rawItem === undefined) return rawItem;

			const nestedItems: Item = {};

			for (const nestedNode of nestedCollectionNodes) {
				nestedItems[nestedNode.fieldKey] = removeTemporaryFields(
					schema,
					rawItem[nestedNode.fieldKey],
					nestedNode,
					nestedNode.type === 'm2o'
						? schema.collections[nestedNode.relation.related_collection!]!.primary
						: schema.collections[nestedNode.relation.collection]!.primary,
					rawItem,
				);
			}

			const fieldsWithFunctionsApplied = fields.map((field) => applyFunctionToColumnName(field));

			items.push(
				fields.length > 0
					? {
						...pick(rawItem, fieldsWithFunctionsApplied, aliasFields),
						...nestedItems,
					}
					: rawItem[primaryKeyField],
			);
		}
	}

	return Array.isArray(rawItem) ? items : items[0]!;
}
