import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/utils/sort.d.ts

/**
 * If a collection has a sort field, this util can be used to move items in that manual order.
 * @param collection The collection to sort
 * @param item Id of the item to move
 * @param to Id of the item to move to
 * @returns Nothing
 */
declare const utilitySort: <Schema>(collection: keyof Schema, item: string | number, to: string | number) => RestCommand<void, Schema>;
//#endregion
export { utilitySort };
//# sourceMappingURL=sort.d.cts.map