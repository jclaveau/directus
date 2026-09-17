import { DirectusRelation } from "../../../schema/relation.cjs";
import { NestedPartial } from "../../../types/utils.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/create/relations.d.ts
type CreateRelationOutput<Schema, Item extends object = DirectusRelation<Schema>> = ApplyQueryFields<Schema, Item, '*'>;
/**
 * Create a new relation.
 *
 * @param item The relation to create
 * @param query Optional return data query
 *
 * @returns Returns the relation object for the created relation.
 */
declare const createRelation: <Schema>(item: NestedPartial<DirectusRelation<Schema>>) => RestCommand<CreateRelationOutput<Schema>, Schema>;
//#endregion
export { CreateRelationOutput, createRelation };
//# sourceMappingURL=relations.d.cts.map