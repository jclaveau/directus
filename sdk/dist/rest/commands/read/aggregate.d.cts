import { AllCollections } from "../../../types/schema.cjs";
import { RestCommand } from "../../types.cjs";
import { AggregationOptions, AggregationOutput } from "../../../types/aggregate.cjs";

//#region src/rest/commands/read/aggregate.d.ts

/**
 * Aggregate allow you to perform calculations on a set of values, returning a single result.
 * @param collection The collection to aggregate
 * @param options The aggregation options
 * @returns Aggregated data
 * @throws Will throw if collection is empty
 */
declare const aggregate: <Schema, Collection extends AllCollections<Schema>, Options extends AggregationOptions<Schema, Collection>>(collection: Collection, options: Options) => RestCommand<AggregationOutput<Schema, Collection, Options>, Schema>;
//#endregion
export { aggregate };
//# sourceMappingURL=aggregate.d.cts.map