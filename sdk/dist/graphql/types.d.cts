//#region src/graphql/types.d.ts
interface GraphqlClient<_Schema> {
  query<Output extends object = Record<string, any>>(query: string, variables?: Record<string, unknown>, scope?: 'items' | 'system'): Promise<Output>;
}
interface GraphqlConfig {
  credentials?: RequestCredentials;
}
type GqlResult<Schema extends object, Collection extends keyof Schema> = { [Key in Collection]: Schema[Collection][] };
type GqlSingletonResult<Schema extends object, Collection extends keyof Schema> = { [Key in Collection]: Schema[Collection] };
//#endregion
export { GqlResult, GqlSingletonResult, GraphqlClient, GraphqlConfig };
//# sourceMappingURL=types.d.cts.map