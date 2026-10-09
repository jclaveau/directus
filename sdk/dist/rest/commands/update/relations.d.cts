import { DirectusRelation } from "../../../schema/relation.cjs";
import { NestedPartial } from "../../../types/utils.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/update/relations.d.ts
type UpdateRelationOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusRelation<Schema>> = ApplyQueryFields<Schema, Item, TQuery['fields']>;
/**
 * Update an existing relation.
 * @param collection
 * @param field
 * @param item
 * @param query
 * @returns Returns the relation object for the created relation.
 */
declare const updateRelation: <Schema, const TQuery extends Query<Schema, DirectusRelation<Schema>>>(collection: DirectusRelation<Schema>["collection"], field: DirectusRelation<Schema>["field"], item: NestedPartial<DirectusRelation<Schema>>, query?: TQuery) => RestCommand<UpdateRelationOutput<Schema, TQuery>, Schema>;
//#endregion
export { UpdateRelationOutput, updateRelation };
//# sourceMappingURL=relations.d.cts.map