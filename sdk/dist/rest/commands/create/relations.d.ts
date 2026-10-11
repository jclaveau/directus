import { DirectusRelation } from "../../../schema/relation.js";
import { NestedPartial } from "../../../types/utils.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { RestCommand } from "../../types.js";

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
//# sourceMappingURL=relations.d.ts.map