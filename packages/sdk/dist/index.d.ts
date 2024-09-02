import { ResponseType, AxiosRequestConfig } from 'axios';

declare abstract class IStorage {
    abstract auth_token: string | null;
    abstract auth_expires: number | null;
    abstract auth_expires_at: number | null;
    abstract auth_refresh_token: string | null;
    abstract get(key: string): string | null;
    abstract set(key: string, value: string): string;
    abstract delete(key: string): string | null;
}

type ID = number | string;
type DefaultType = {
    [field: string]: any;
};
type SystemType<T> = DefaultType & T;
type TypeMap = {
    [k: string]: unknown;
};
type TypeOf<T extends TypeMap, K extends keyof T> = T[K] extends undefined ? DefaultType : T[K];
type Omit$1<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
type PartialBy<T, K extends keyof T> = Omit$1<T, K> & Partial<Pick<T, K>>;
type ActivityType = SystemType<{
    action: string;
    collection: string;
    comment: string | null;
    id: number;
    ip: string;
    item: string;
    origin: string | null;
    timestamp: string;
    revisions: number[];
    user: string;
    user_agent: string;
}>;
type Comment = SystemType<{
    collection: string;
    comment: string;
    item: string;
}>;
type CollectionType = SystemType<{
    collection: string;
    meta: CollectionMetaType;
    schema: CollectionSchemaType | null;
}>;
type CollectionMetaType = SystemType<{
    accountability: string | null;
    archive_app_filter: boolean;
    archive_field: string | null;
    archive_value: string | null;
    collapse: string;
    collection: string;
    display_template: string | null;
    group: string | null;
    hidden: boolean;
    icon: string | null;
    item_duplication_fields: string[] | null;
    note: string | null;
    singleton: boolean;
    sort_field: string | null;
    translations: CollectionMetaTranslationType[] | null;
    unarchive_value: string | null;
}>;
type CollectionMetaTranslationType = SystemType<{
    language: string;
    plural: string;
    singular: string;
    translation: string;
}>;
type CollectionSchemaType = SystemType<{
    comment: string | null;
    name: string;
    schema: string;
}>;
type FieldType = SystemType<{
    collection: string;
    field: string;
    meta: FieldMetaType;
    schema: FieldSchemaType;
    type: string;
}>;
type FieldMetaType = SystemType<{
    collection: string;
    conditions: FieldMetaConditionType[] | null;
    display: string | null;
    display_options: string | null;
    field: string;
    group: string | null;
    hidden: boolean;
    id: number;
    interface: string;
    note: string | null;
    options: DefaultType | null;
    readonly: boolean;
    required: boolean;
    sort: number | null;
    special: string[] | null;
    translations: FieldMetaTranslationType[] | null;
    validation: DefaultType | null;
    validation_message: string | null;
    width: string;
}>;
type FieldMetaConditionType = SystemType<{
    hidden: boolean;
    name: string;
    options: FieldMetaConditionOptionType;
    readonly: boolean;
    required: boolean;
    rule: DefaultType;
}>;
type FieldMetaTranslationType = SystemType<{
    language: string;
    translation: string;
}>;
type FieldMetaConditionOptionType = SystemType<{
    clear: boolean;
    font: string;
    iconLeft?: string;
    iconRight?: string;
    masked: boolean;
    placeholder: string;
    slug: boolean;
    softLength?: number;
    trim: boolean;
}>;
type FieldSchemaType = SystemType<{
    comment: string | null;
    data_type: string;
    default_value: any | null;
    foreign_key_column: string | null;
    foreign_key_schema: string | null;
    foreign_key_table: string | null;
    generation_expression: unknown | null;
    has_auto_increment: boolean;
    is_generated: boolean;
    is_nullable: boolean;
    is_primary_key: boolean;
    is_unique: boolean;
    max_length: number | null;
    name: string;
    numeric_precision: number | null;
    numeric_scale: number | null;
    schema: string;
    table: string;
}>;
type FileType = SystemType<{
    charset: string | null;
    description: string | null;
    duration: number | null;
    embed: unknown | null;
    filename_disk: string;
    filename_download: string;
    filesize: string;
    folder: string;
    height: number | null;
    id: string;
    location: string | null;
    metadata: DefaultType;
    modified_by: string;
    modified_on: string;
    storage: string;
    tags: string[];
    title: string;
    type: string;
    uploaded_by: string;
    uploaded_on: string;
    width: number | null;
}>;
type FolderType = SystemType<{
    id: string;
    name: string;
    parent: string;
}>;
type PermissionType = SystemType<{
    action: string;
    collection: string | null;
    fields: string[];
    id: string;
    permissions: DefaultType;
    presets: DefaultType | null;
    role: string | null;
    system?: boolean;
    validation: DefaultType | null;
}>;
type PresetType = SystemType<{
    collection: string;
    color: string | null;
    bookmark: string | null;
    filter: DefaultType;
    icon: string | null;
    id: number;
    layout: string | null;
    layout_options: DefaultType;
    layout_query: DefaultType;
    refresh_interval: number | null;
    role: string | null;
    search: string | null;
    user: string | null;
}>;
type RelationType = SystemType<{
    collection: string;
    field: string;
    related_collection: string;
    schema: RelationSchemaType;
    meta: RelationMetaType;
}>;
type RelationMetaType = SystemType<{
    id: number | null;
    junction_field: string | null;
    many_collection: string | null;
    many_field: string | null;
    one_allowed_collections: string | null;
    one_collection: string | null;
    one_collection_field: string | null;
    one_deselect_action: string;
    one_field: string | null;
    sort_field: string | null;
    system: boolean | null;
}>;
type RelationSchemaType = SystemType<{
    column: string;
    constraint_name: string;
    foreign_key_column: string;
    foreign_key_schema: string;
    foreign_key_table: string;
    on_delete: string;
    on_update: string;
    table: string;
}>;
type RevisionType = SystemType<{
    activity: number;
    collection: string;
    data: DefaultType;
    delta: DefaultType;
    id: number;
    item: string;
    parent: number | null;
}>;
type RoleType = SystemType<{
    admin_access: boolean;
    app_access: boolean;
    description: string | null;
    enforce_tfa: boolean;
    icon: string;
    id: string;
    ip_access: string[] | null;
    name: string;
    users: string[];
}>;
type SettingType = SystemType<{
    id: 1;
    auth_login_attempts: number;
    auth_password_policy: string | null;
    custom_css: string | null;
    project_color: string | null;
    project_logo: string | null;
    project_name: string;
    project_url: string;
    public_background: string | null;
    public_foreground: string | null;
    public_note: string | null;
    storage_asset_presets: {
        fit: string;
        height: number;
        width: number;
        quality: number;
        key: string;
        withoutEnlargement: boolean;
    }[] | null;
    storage_asset_transform: 'all' | 'none' | 'presets';
}>;
type UserType = SystemType<{
    auth_data: DefaultType;
    avatar: string;
    description: string | null;
    email: string | null;
    email_notifications: boolean;
    external_identifier: string;
    first_name: string | null;
    id: string;
    language: string | null;
    last_access: string | null;
    last_name: string | null;
    last_page: string | null;
    location: string | null;
    password: string | null;
    provider: string;
    role: string;
    status: string;
    tags: string[];
    theme: string;
    tfa_secret: string | null;
    title: string | null;
    token: string | null;
}>;
type TfaType = SystemType<{
    secret: string;
    otpauth_url: string;
}>;
type RequiredKeys<T> = {
    [K in keyof T]-?: Record<string, never> extends {
        [P in K]: T[K];
    } ? never : K;
}[keyof T];
type OptionalKeys<T> = {
    [K in keyof T]-?: Record<string, never> extends {
        [P in K]: T[K];
    } ? K : never;
}[keyof T];

type Field = string;
type Item = Record<string, any>;
type ItemInput<T> = {
    [P in keyof T]?: T[P] extends Record<string, any> ? ItemInput<T[P]> : T[P];
};
type InferQueryType<T extends ManyItems<any> | QueryOne<any>> = 'data' extends keyof T ? T['data'] : T;
type DefaultItem<T> = {
    [K in keyof T]: NonNullable<T[K]> extends (infer U)[] ? Extract<NonNullable<U>, Record<string, unknown>> extends never ? U[] : (string | number)[] : Extract<T[K], Record<string, unknown>> extends never ? T[K] : Exclude<T[K], Record<string, unknown>> | string | number;
};
type OneItem<T extends Item, Q extends QueryOne<T> = Record<'fields', undefined>, F extends string[] | false = QueryFields<Q>> = (F extends false ? DefaultItem<T> : PickedDefaultItem<T, F>) | null | undefined;
type ManyItems<T extends Item, Q extends QueryMany<T> = Record<string, any>> = {
    data?: NonNullable<OneItem<T, Q>>[] | null;
    meta?: ItemMetadata;
};
type ItemMetadata = {
    total_count?: number;
    filter_count?: number;
};
type Payload = Record<string, any>;
declare enum Meta {
    TOTAL_COUNT = "total_count",
    FILTER_COUNT = "filter_count"
}
type QueryFields<Q extends Record<string, any>> = Q extends Record<'fields', unknown> ? Q['fields'] extends string ? [Q['fields']] : Q['fields'] extends string[] ? Q['fields'] : false : false;
type DeepPathBranchHelper<T, K extends keyof T, V, R extends string> = K extends keyof V ? TreeBranch<T[K], R, V[K]> : K extends keyof (V & {
    [_ in K]: unknown;
}) ? TreeBranch<T[K], R, (V & {
    [_ in K]: unknown;
})[K]> : never;
type WildCardHelper<T, K extends keyof T, V, R extends string> = string extends K ? {
    [K: string]: T[K];
} : NonNullable<T[K]> extends (infer U)[] ? Extract<NonNullable<U>, Record<string, unknown>> extends never ? TreeLeaf<U> : DeepPathBranchHelper<T, K, V, R> : Extract<NonNullable<T[K]>, Record<string, unknown>> extends never ? TreeLeaf<T[K]> : DeepPathBranchHelper<T, K, V, R>;
type DeepPathToObject<Path extends string, T extends Record<string, any>, Val = Record<string, never>> = string extends Path ? never : Path extends `${infer Key}.${infer Rest}` ? Key extends '*' ? Rest extends `${infer NextVal}.${string}` ? NextVal extends '*' ? Val & {
    [K in keyof T]: WildCardHelper<T, K, Val, Rest>;
} : Val & {
    [K in keyof T]: NextVal extends keyof T[K] ? DeepPathBranchHelper<T, K, Val, Rest> : never;
} : Rest extends '*' ? Val & {
    [K in keyof T]: WildCardHelper<T, K, Val, Rest>;
} : Val & {
    [K in keyof T]: Rest extends keyof T[K] ? DeepPathBranchHelper<T, K, Val, Rest> : never;
} : Key extends keyof T ? Val & {
    [K in OptionalKeys<Pick<T, Key>>]?: DeepPathBranchHelper<T, K, Val, Rest>;
} & {
    [K in RequiredKeys<Pick<T, Key>>]: DeepPathBranchHelper<T, K, Val, Rest>;
} : never : string extends keyof T ? Val & Record<string, unknown> : Path extends keyof T ? Val & {
    [K in OptionalKeys<Pick<T, Path>>]?: TreeLeaf<T[K]>;
} & {
    [K in RequiredKeys<Pick<T, Path>>]: TreeLeaf<T[K]>;
} : Path extends '*' ? Val & {
    [K in OptionalKeys<T>]?: TreeLeaf<T[K]>;
} & {
    [K in RequiredKeys<T>]: TreeLeaf<T[K]>;
} : never;
type TreeBranch<T, Path extends string, Val = Record<string, never>, NT extends Record<string, any> = NonNullable<T>> = NT extends (infer U)[] ? (ArrayTreeBranch<Extract<U, Record<string, unknown>>, Path, Val> | Exclude<U, Record<string, unknown>>)[] : IsUnion<T> extends true ? DeepPathToObject<Path, Extract<T, Record<string, unknown>>, Val> | Exclude<T, Record<string, unknown>> : DeepPathToObject<Path, NT, Val>;
type ArrayTreeBranch<U, Path extends string, Val = Record<string, never>, NU extends Record<string, any> = NonNullable<U>> = Extract<NU, Record<string, unknown>> extends infer OB extends Record<string, any> ? Val extends (infer _)[] ? DeepPathToObject<Path, OB, Val[number]> : DeepPathToObject<Path, OB, Val> : Val extends (infer _)[] ? DeepPathToObject<Path, NU, Val[number]> : DeepPathToObject<Path, NU, Val>;
type TreeLeaf<T, NT = NonNullable<T>> = NT extends (infer U)[] ? Exclude<U, Record<string, unknown>>[] : Exclude<T, Record<string, unknown>>;
type UnionToIntersectionFn<TUnion> = (TUnion extends TUnion ? (union: () => TUnion) => void : never) extends (intersection: infer Intersection) => void ? Intersection : never;
type LastUnion<TUnion> = UnionToIntersectionFn<TUnion> extends () => infer Last ? Last : never;
type UnionToTuple<TUnion, TResult extends Array<unknown> = []> = TUnion[] extends never[] ? TResult : UnionToTuple<Exclude<TUnion, LastUnion<TUnion>>, [...TResult, LastUnion<TUnion>]>;
type PickedDefaultItem<T extends Item, Fields, Val = Record<string, unknown>> = unknown extends T ? any : Fields extends string[] ? Fields['length'] extends 0 ? T : UnionToTuple<Fields[number]> extends [infer First, ...infer Rest] ? First extends string ? IntersectionToObject<Rest['length'] extends 0 ? DeepPathToObject<First, T, Val> : PickedDefaultItem<T, Rest, DeepPathToObject<First, T, Val>>> : never : never : never;
type IntersectionToObject<U> = U extends (infer U2)[] ? Array<IntersectionToObject<U2>> : U extends infer O ? O extends string ? string : O extends number ? number : O extends symbol ? symbol : O extends boolean ? boolean : {
    [K in keyof O as unknown extends O[K] ? never : K]: O[K] extends (infer U)[] ? Array<IntersectionToObject<U>> : IsUnion<O[K]> extends true ? IntersectionToObject<O[K]> : O[K] extends Record<string, any> ? IntersectionToObject<O[K]> : O[K];
} : never;
type QueryOne<T = unknown> = {
    fields?: unknown extends T ? string | string[] : DotSeparated<T, 5> | DotSeparated<T, 5>[];
    search?: string;
    deep?: Deep<T>;
    export?: 'json' | 'csv' | 'xml';
    filter?: Filter<T>;
};
type QueryMany<T> = QueryOne<T> & {
    sort?: Sort<T>;
    limit?: number;
    offset?: number;
    page?: number;
    meta?: keyof ItemMetadata | '*';
    groupBy?: string | string[];
    aggregate?: Aggregate;
    alias?: Record<string, string>;
};
type Deep<T> = {
    [K in keyof SingleItem<T>]?: DeepQueryMany<SingleItem<T>[K]>;
};
type DeepQueryMany<T> = {
    [K in keyof QueryMany<SingleItem<T>> as `_${string & K}`]: QueryMany<SingleItem<T>>[K];
} & {
    [K in keyof NestedObjectKeys<SingleItem<T>>]?: DeepQueryMany<NestedObjectKeys<SingleItem<T>>[K]>;
};
type NestedObjectKeys<T> = {
    [P in keyof T]: NonNullable<T[P]> extends (infer U)[] ? Extract<U, Record<string, unknown>> extends Record<string, unknown> ? Extract<U, Record<string, unknown>> : never : Extract<NonNullable<T[P]>, Record<string, unknown>> extends Record<string, unknown> ? Extract<NonNullable<T[P]>, Record<string, unknown>> : never;
};
type SharedAggregate = {
    avg?: string[];
    avgDistinct?: string[];
    count?: string[];
    countDistinct?: string[];
    sum?: string[];
    sumDistinct?: string[];
    min?: string[];
    max?: string[];
};
type Aggregate = {
    [K in keyof SharedAggregate]: string;
};
type Sort<T> = (`${Extract<keyof SingleItem<T>, string>}` | `-${Extract<keyof SingleItem<T>, string>}`)[];
type FilterOperators<T> = {
    _eq?: T;
    _neq?: T;
    _gt?: T;
    _gte?: T;
    _lt?: T;
    _lte?: T;
    _in?: T[];
    _nin?: T[];
    _between?: [T, T];
    _nbetween?: [T, T];
    _contains?: T;
    _ncontains?: T;
    _starts_with?: T;
    _nstarts_with?: T;
    _ends_with?: T;
    _nends_with?: T;
    _empty?: boolean;
    _nempty?: boolean;
    _nnull?: boolean;
    _null?: boolean;
    _intersects?: T;
    _nintersects?: T;
    _intersects_bbox?: T;
    _nintersects_bbox?: T;
};
type LogicalFilterAnd<T> = {
    _and: Filter<T>[];
};
type LogicalFilterOr<T> = {
    _or: Filter<T>[];
};
type LogicalFilter<T> = LogicalFilterAnd<T> | LogicalFilterOr<T>;
type FieldFilter<T> = {
    [K in keyof SingleItem<T>]?: FilterOperators<SingleItem<T>[K]> | FieldFilter<SingleItem<T>[K]>;
};
type Filter<T> = LogicalFilter<T> | FieldFilter<T>;
type ItemsOptions = {
    requestOptions: TransportRequestOptions;
};
type SingleItem<T> = Exclude<Single<T>, ID>;
type Single<T, NT = NonNullable<T>> = NT extends Array<unknown> ? NT[number] : NT;
/**
 * CRUD at its finest
 */
interface IItems<T extends Item> {
    createOne<Q extends QueryOne<T>>(item: ItemInput<T>, query?: Q, options?: ItemsOptions): Promise<OneItem<T, Q>>;
    createMany<Q extends QueryOne<T>>(items: ItemInput<T>[], query?: Q, options?: ItemsOptions): Promise<ManyItems<T, Q>>;
    readOne<Q extends QueryOne<T>>(id: ID, query?: Q, options?: ItemsOptions): Promise<OneItem<T, Q>>;
    readMany<Q extends QueryMany<T>>(ids: ID[], query?: Q, options?: ItemsOptions): Promise<ManyItems<T, Q>>;
    readByQuery<Q extends QueryMany<T>>(query?: Q, options?: ItemsOptions): Promise<ManyItems<T, Q>>;
    updateOne<Q extends QueryOne<T>>(id: ID, item: ItemInput<T>, query?: Q, options?: ItemsOptions): Promise<OneItem<T, Q>>;
    updateMany<Q extends QueryMany<T>>(ids: ID[], item: ItemInput<T>, query?: Q, options?: ItemsOptions): Promise<ManyItems<T, Q>>;
    updateBatch<Q extends QueryMany<T>>(items: ItemInput<T>[], query?: Q, options?: ItemsOptions): Promise<ManyItems<T, Q>>;
    deleteOne(id: ID, options?: ItemsOptions): Promise<void>;
    deleteMany(ids: ID[], options?: ItemsOptions): Promise<void>;
}
declare class EmptyParamError extends Error {
    constructor(paramName?: string);
}
type IsUnion<T, U extends T = T> = T extends unknown ? ([U] extends [T] ? false : true) : false;
type AppendToPath<Path extends string, Appendix extends string> = Path extends '' ? Appendix : `${Path}.${Appendix}`;
type OneLevelUp<Path extends string> = Path extends `${infer Start}.${infer Middle}.${infer Rest}` ? Rest extends `${string}.${string}.${string}` ? `${Start}.${Middle}.${OneLevelUp<Rest>}` : Rest extends `${infer NewMiddle}.${string}` ? `${Start}.${Middle}.${NewMiddle}` : Rest extends string ? `${Start}.${Middle}` : '' : Path extends `${infer Start}.${string}` ? Start : '';
type LevelsToAsterisks<Path extends string> = Path extends `${string}.${string}.${infer Rest}` ? Rest extends `${string}.${string}.${string}` ? `*.*.${LevelsToAsterisks<Rest>}` : Rest extends `${string}.${string}` ? `*.*.*.*` : Rest extends string ? `*.*.*` : '' : Path extends `${string}.${string}` ? '*.*' : Path extends '' ? '' : '*';
type DefaultAppends<Path extends string, Appendix extends string, Nested extends boolean = true, Prepend extends boolean = true> = AppendToPath<Path, Appendix> | AppendToPath<LevelsToAsterisks<Path>, Appendix> | (Prepend extends true ? AppendToPath<Path, '*'> | AppendToPath<LevelsToAsterisks<Path>, Appendix> | (OneLevelUp<Path> extends '' ? never : AppendToPath<AppendToPath<OneLevelUp<Path>, '*'>, Appendix>) : never) | (Nested extends true ? AppendToPath<AppendToPath<LevelsToAsterisks<Path>, Appendix>, '*'> | AppendToPath<AppendToPath<LevelsToAsterisks<Path>, '*'>, '*'> | AppendToPath<AppendToPath<Path, Appendix>, '*'> | AppendToPath<AppendToPath<Path, '*'>, '*'> | (OneLevelUp<Path> extends '' ? never : AppendToPath<AppendToPath<AppendToPath<OneLevelUp<Path>, '*'>, Appendix>, '*'>) : never);
type DotSeparated<T, N extends number, Level extends number[] = [], Path extends string = ''> = Level['length'] extends N ? Path : T extends (infer U)[] ? Extract<U, Record<string, unknown>> extends Record<string, unknown> ? DotSeparated<Extract<U, Record<string, unknown>>, N, Level, Path> : Path : Extract<NonNullable<T>, Record<string, unknown>> extends Record<string, unknown> ? {
    [K in keyof T]: K extends string ? NonNullable<T[K]> extends (infer U)[] ? Extract<U, Record<string, unknown>> extends never ? DefaultAppends<Path, K, false> : DotSeparated<Extract<U, Record<string, unknown>>, N, [...Level, 0], AppendToPath<Path, K>> | DefaultAppends<Path, K> : Extract<T[K], Record<string, unknown>> extends never ? DefaultAppends<Path, K, false> : DotSeparated<Extract<T[K], Record<string, unknown>>, N, [...Level, 0], AppendToPath<Path, K>> | DefaultAppends<Path, K> : never;
}[keyof T] : never;

type TransportErrorDescription = {
    message?: string;
    extensions?: Record<string, any> & {
        code?: string;
    };
};
type TransportResponse<T, R = any> = {
    raw: R;
    data?: T;
    meta?: ItemMetadata;
    errors?: TransportErrorDescription[];
    status: number;
    statusText?: string;
    headers: any;
};
type TransportMethods = 'get' | 'delete' | 'head' | 'options' | 'post' | 'put' | 'patch';
type TransportRequestOptions = {
    params?: any;
    headers?: any;
    responseType?: ResponseType;
    onUploadProgress?: ((progressEvent: any) => void) | undefined;
    maxBodyLength?: number;
    maxContentLength?: number;
};
type TransportOptions = TransportRequestOptions & {
    url: string;
    beforeRequest?: (config: AxiosRequestConfig) => Promise<AxiosRequestConfig>;
};
declare abstract class ITransport {
    abstract get<T = any, R = any>(path: string, options?: TransportRequestOptions): Promise<TransportResponse<T, R>>;
    abstract head<T = any, R = any>(path: string, options?: TransportRequestOptions): Promise<TransportResponse<T, R>>;
    abstract options<T = any, R = any>(path: string, options?: TransportRequestOptions): Promise<TransportResponse<T, R>>;
    abstract delete<T = any, P = any, R = any>(path: string, data?: P, options?: TransportRequestOptions): Promise<TransportResponse<T, R>>;
    abstract post<T = any, P = any, R = any>(path: string, data?: P, options?: TransportRequestOptions): Promise<TransportResponse<T, R>>;
    abstract put<T = any, P = any, R = any>(path: string, data?: P, options?: TransportRequestOptions): Promise<TransportResponse<T, R>>;
    abstract patch<T = any, P = any, R = any>(path: string, data?: P, options?: TransportRequestOptions): Promise<TransportResponse<T, R>>;
}
declare class TransportError<T = any, R = any> extends Error {
    readonly errors: TransportErrorDescription[];
    readonly response?: Partial<TransportResponse<T, R>>;
    readonly parent: Error | null;
    constructor(parent: Error | null, response?: Partial<TransportResponse<T, R>>);
}

declare class PasswordsHandler {
    private transport;
    constructor(transport: ITransport);
    request(email: string, reset_url?: string | null): Promise<void>;
    reset(token: string, password: string): Promise<void>;
}

type AuthCredentials = {
    email: string;
    password: string;
    otp?: string;
};
type AuthToken = string;
type AuthTokenType = 'DynamicToken' | 'StaticToken' | null;
type AuthResult = {
    access_token: string;
    expires: number;
    refresh_token?: string;
};
type AuthMode = 'json' | 'cookie';
type AuthOptions = {
    mode?: AuthMode;
    autoRefresh?: boolean;
    msRefreshBeforeExpires?: number;
    staticToken?: string;
    transport: ITransport;
    storage: IStorage;
};
declare abstract class IAuth {
    mode: AuthMode;
    abstract readonly token: Promise<string | null>;
    abstract readonly password: PasswordsHandler;
    abstract login(credentials: AuthCredentials): Promise<AuthResult>;
    abstract refresh(): Promise<AuthResult | false>;
    abstract refreshIfExpired(): Promise<void>;
    abstract static(token: AuthToken): Promise<boolean>;
    abstract logout(): Promise<void>;
}

declare class ItemsHandler<T extends Item> implements IItems<T> {
    protected transport: ITransport;
    protected endpoint: string;
    protected collection: string;
    constructor(collection: string, transport: ITransport);
    readOne<Q extends QueryOne<T>>(id: ID, query?: Q, options?: ItemsOptions): Promise<OneItem<T, Q>>;
    readMany<Q extends QueryMany<T>>(ids: ID[], query?: Q, options?: ItemsOptions): Promise<ManyItems<T, Q>>;
    readByQuery<Q extends QueryMany<T>>(query?: Q, options?: ItemsOptions): Promise<ManyItems<T, Q>>;
    createOne<Q extends QueryOne<T>>(item: ItemInput<T>, query?: Q, options?: ItemsOptions): Promise<OneItem<T, Q>>;
    createMany<Q extends QueryMany<T>>(items: ItemInput<T>[], query?: Q, options?: ItemsOptions): Promise<ManyItems<T, Q>>;
    updateOne<Q extends QueryOne<T>>(id: ID, item: ItemInput<T>, query?: Q, options?: ItemsOptions): Promise<OneItem<T, Q>>;
    updateMany<Q extends QueryMany<T>>(ids: ID[], data: ItemInput<T>, query?: Q, options?: ItemsOptions): Promise<ManyItems<T, Q>>;
    updateBatch<Q extends QueryMany<T>>(items: ItemInput<T>[], query?: Q, options?: ItemsOptions): Promise<ManyItems<T, Q>>;
    updateByQuery<Q extends QueryMany<T>>(updateQuery: QueryMany<T>, data: ItemInput<T>, query?: Q, options?: ItemsOptions): Promise<ManyItems<T, Q>>;
    deleteOne(id: ID, options?: ItemsOptions): Promise<void>;
    deleteMany(ids: ID[], options?: ItemsOptions): Promise<void>;
}

declare class CommentsHandler<T> {
    private transport;
    constructor(transport: ITransport);
    create(comment: Comment): Promise<ActivityItem<T>>;
    update(comment_activity_id: ID, comment: string): Promise<ActivityItem<T>>;
    delete(comment_activity_id: ID): Promise<void>;
}

/**
 * Activity handler
 */

type ActivityItem<T = DefaultType> = ActivityType & T;
declare class ActivityHandler<T = DefaultType> extends ItemsHandler<ActivityItem<T>> {
    private _comments;
    constructor(transport: ITransport);
    get comments(): CommentsHandler<T>;
}

declare class AssetsHandler {
    private transport;
    constructor(transport: ITransport);
    readOne(id: ID): Promise<any>;
}

/**
 * Collections handler
 */

type CollectionItem<T = DefaultType> = CollectionType & T;
declare class CollectionsHandler<T = CollectionItem> {
    transport: ITransport;
    constructor(transport: ITransport);
    readOne(collection: string): Promise<OneItem<NonNullable<T>>>;
    readAll(): Promise<ManyItems<NonNullable<T>>>;
    createOne(collection: ItemInput<T>): Promise<OneItem<NonNullable<T>>>;
    createMany(collections: ItemInput<T>[]): Promise<ManyItems<NonNullable<T>>>;
    updateOne(collection: string, item: ItemInput<T>, query?: QueryOne<T>): Promise<OneItem<NonNullable<T>>>;
    deleteOne(collection: string): Promise<void>;
}

/**
 * Fields handler
 */

type FieldItem<T = DefaultType> = FieldType & T;
declare class FieldsHandler<T = FieldItem> {
    transport: ITransport;
    constructor(transport: ITransport);
    readOne(collection: string, id: ID): Promise<OneItem<NonNullable<T>>>;
    readMany(collection: string): Promise<ManyItems<NonNullable<T>>>;
    readAll(): Promise<ManyItems<NonNullable<T>>>;
    createOne(collection: string, item: ItemInput<T>): Promise<OneItem<NonNullable<T>>>;
    updateOne(collection: string, field: string, item: ItemInput<T>): Promise<OneItem<NonNullable<T>>>;
    deleteOne(collection: string, field: string): Promise<void>;
}

/**
 * Files handler
 */

type FileItem<T = DefaultType> = FileType & T;
declare class FilesHandler<T = DefaultType> extends ItemsHandler<FileItem<T>> {
    constructor(transport: ITransport);
    import(body: {
        url: string;
        data?: ItemInput<T>;
    }): Promise<OneItem<NonNullable<T>>>;
}

/**
 * Folders handler
 */

type FolderItem<T = DefaultType> = FolderType & T;
declare class FoldersHandler<T = DefaultType> extends ItemsHandler<FolderItem<T>> {
    constructor(transport: ITransport);
}

/**
 * Permissions handler
 */

type PermissionItem<T = DefaultType> = PermissionType & T;
declare class PermissionsHandler<T = DefaultType> extends ItemsHandler<PermissionItem<T>> {
    constructor(transport: ITransport);
}

/**
 * Presets handler
 */

type PresetItem<T = DefaultType> = PresetType & T;
declare class PresetsHandler<T = DefaultType> extends ItemsHandler<PresetItem<T>> {
    constructor(transport: ITransport);
}

/**
 * Relations handler
 */

type RelationItem<T = DefaultType> = RelationType & T;
declare class RelationsHandler<T extends Item = RelationItem> {
    transport: ITransport;
    constructor(transport: ITransport);
    readOne(collection: string, id: ID): Promise<OneItem<T>>;
    readMany(collection: string): Promise<ManyItems<T>>;
    readAll(): Promise<ManyItems<T>>;
    createOne(item: ItemInput<T>): Promise<OneItem<T>>;
    updateOne(collection: string, field: string, item: ItemInput<T>): Promise<OneItem<T>>;
    deleteOne(collection: string, field: string): Promise<void>;
}

/**
 * Revisions handler
 */

type RevisionItem<T = DefaultType> = RevisionType & T;
declare class RevisionsHandler<T = DefaultType> extends ItemsHandler<RevisionItem<T>> {
    constructor(transport: ITransport);
}

/**
 * Roles handler
 */

type RoleItem<T = DefaultType> = RoleType & T;
declare class RolesHandler<T = DefaultType> extends ItemsHandler<RoleItem<T>> {
    constructor(transport: ITransport);
}

/**
 * Server handler
 */

type ServerInfo = {
    project: {
        project_name: string;
        project_logo: string | null;
        project_color: string;
        public_foreground: string | null;
        public_background: string | null;
        public_note: string;
        custom_css: string;
    };
    directus?: {
        version: string;
    };
};
declare class ServerHandler {
    private transport;
    constructor(transport: ITransport);
    ping(): Promise<'pong'>;
    info(): Promise<ServerInfo>;
    oas(): Promise<any>;
}

/**
 * CRUD at its finest
 */
interface ISingleton<T extends Item> {
    read<Q extends QueryOne<T>>(query?: Q): Promise<OneItem<T, Q>>;
    update<Q extends QueryOne<T>>(item: ItemInput<T>, query?: Q): Promise<OneItem<T, Q>>;
}

declare class SingletonHandler<T extends Item> implements ISingleton<T> {
    protected collection: string;
    protected transport: ITransport;
    protected endpoint: string;
    constructor(collection: string, transport: ITransport);
    read<Q extends QueryOne<T>>(query?: Q): Promise<OneItem<T, Q>>;
    update<Q extends QueryOne<T>>(data: ItemInput<T>, _query?: Q): Promise<OneItem<T, Q>>;
}

/**
 * Settings handler
 */

type SettingItem<T = DefaultType> = SettingType & T;
declare class SettingsHandler<T extends Item = SettingItem> extends SingletonHandler<T> {
    constructor(transport: ITransport);
}

declare class InvitesHandler {
    private transport;
    constructor(transport: ITransport);
    send(email: string, role: ID, invite_url?: string): Promise<void>;
    accept(token: ID, password: string): Promise<void>;
}

type TfaItem<T = DefaultType> = TfaType & T;
declare class TFAHandler {
    private transport;
    constructor(transport: ITransport);
    generate(password: string): Promise<TfaItem>;
    enable(secret: string, otp: string): Promise<void>;
    disable(otp: string): Promise<void>;
}

declare class MeHandler<T> {
    private _transport;
    private _tfa?;
    constructor(transport: ITransport);
    get tfa(): TFAHandler;
    read(query?: QueryOne<T>): Promise<ItemInput<T>>;
    update(data: ItemInput<T>, query?: QueryOne<T>): Promise<ItemInput<T>>;
}

/**
 * Users handler
 */

type UserItem<T = DefaultType> = UserType & T;
declare class UsersHandler<T = DefaultType> extends ItemsHandler<UserItem<T>> {
    private _invites?;
    private _me?;
    constructor(transport: ITransport);
    get invites(): InvitesHandler;
    get me(): MeHandler<UserItem<T>>;
}

/**
 * Utils handler
 */

declare class UtilsHandler {
    private transport;
    constructor(transport: ITransport);
    random: {
        string: (length?: number) => Promise<string>;
    };
    hash: {
        generate: (string: string) => Promise<string>;
        verify: (string: string, hash: string) => Promise<boolean>;
    };
    sort(collection: string, item: ID, to: ID): Promise<void>;
    revert(revision: ID): Promise<void>;
}

declare class GraphQLHandler {
    private transport;
    constructor(transport: ITransport);
    private request;
    items<T>(query: string, variables?: any): Promise<TransportResponse<T>>;
    system<T>(query: string, variables?: any): Promise<TransportResponse<T>>;
}

type DirectusTypes = {
    activity: undefined;
    assets: undefined;
    collections: undefined;
    fields: undefined;
    files: undefined;
    folders: undefined;
    permissions: undefined;
    presets: undefined;
    relations: undefined;
    revisions: undefined;
    roles: undefined;
    settings: undefined;
    users: undefined;
};
interface IDirectusBase {
    readonly url: string;
    readonly auth: IAuth;
    readonly storage: IStorage;
    readonly transport: ITransport;
    readonly server: ServerHandler;
    readonly utils: UtilsHandler;
    readonly graphql: GraphQLHandler;
}
interface IDirectus<T extends Item> extends IDirectusBase {
    readonly activity: ActivityHandler<TypeOf<T, 'directus_activity'>>;
    readonly assets: AssetsHandler;
    readonly collections: CollectionsHandler<TypeOf<T, 'directus_collections'>>;
    readonly files: FilesHandler<TypeOf<T, 'directus_files'>>;
    readonly fields: FieldsHandler<TypeOf<T, 'directus_fields'>>;
    readonly folders: FoldersHandler<TypeOf<T, 'directus_folders'>>;
    readonly permissions: PermissionsHandler<TypeOf<T, 'directus_permissions'>>;
    readonly presets: PresetsHandler<TypeOf<T, 'directus_presets'>>;
    readonly revisions: RevisionsHandler<TypeOf<T, 'directus_revisions'>>;
    readonly relations: RelationsHandler<TypeOf<T, 'directus_relations'>>;
    readonly roles: RolesHandler<TypeOf<T, 'directus_roles'>>;
    readonly users: UsersHandler<TypeOf<T, 'directus_users'>>;
    readonly settings: SettingsHandler<TypeOf<T, 'directus_settings'>>;
    items<C extends string, I extends Item>(collection: C): IItems<I>;
    singleton<C extends string, I extends Item>(collection: C): ISingleton<I>;
}

type StorageOptions = {
    prefix?: string;
};
declare abstract class BaseStorage extends IStorage {
    protected prefix: string;
    get auth_token(): string | null;
    set auth_token(value: string | null);
    get auth_expires(): number | null;
    set auth_expires(value: number | null);
    get auth_expires_at(): number | null;
    set auth_expires_at(value: number | null);
    get auth_refresh_token(): string | null;
    set auth_refresh_token(value: string | null);
    abstract get(key: string): string | null;
    abstract set(key: string, value: string): string;
    abstract delete(key: string): string | null;
    constructor(options?: StorageOptions);
}

declare class MemoryStorage extends BaseStorage {
    private values;
    get(key: string): string | null;
    set(key: string, value: string): string;
    delete(key: string): string | null;
    private key;
}

declare class LocalStorage extends BaseStorage {
    get(key: string): string | null;
    set(key: string, value: string): string;
    delete(key: string): string | null;
    private key;
}

/**
 * Transport implementation
 */
declare class Transport extends ITransport {
    private axios;
    private config;
    constructor(config: TransportOptions);
    beforeRequest(config: AxiosRequestConfig): Promise<AxiosRequestConfig>;
    get url(): string;
    protected request<T = any, R = any>(method: TransportMethods, path: string, data?: any, options?: Omit<TransportOptions, 'url'>): Promise<TransportResponse<T, R>>;
    get<T = any>(path: string, options?: TransportOptions): Promise<TransportResponse<T>>;
    head<T = any>(path: string, options?: TransportOptions): Promise<TransportResponse<T>>;
    options<T = any>(path: string, options?: TransportOptions): Promise<TransportResponse<T>>;
    delete<T = any, D = any>(path: string, data?: D, options?: TransportOptions): Promise<TransportResponse<T>>;
    put<T = any, D = any>(path: string, data?: D, options?: TransportOptions): Promise<TransportResponse<T>>;
    post<T = any, D = any>(path: string, data?: D, options?: TransportOptions): Promise<TransportResponse<T>>;
    patch<T = any, D = any>(path: string, data?: D, options?: TransportOptions): Promise<TransportResponse<T>>;
}

type AuthStorage<T extends AuthTokenType = 'DynamicToken'> = {
    access_token: T extends 'DynamicToken' | 'StaticToken' ? string : null;
    expires: T extends 'DynamicToken' ? number : null;
    refresh_token?: T extends 'DynamicToken' ? string : null;
};
declare class Auth extends IAuth {
    autoRefresh: boolean;
    msRefreshBeforeExpires: number;
    staticToken: string;
    private _storage;
    private _transport;
    private passwords?;
    private _refreshPromise?;
    constructor(options: AuthOptions);
    get storage(): IStorage;
    get transport(): ITransport;
    get token(): Promise<string | null>;
    get password(): PasswordsHandler;
    private resetStorage;
    private updateStorage;
    refreshIfExpired(): Promise<void>;
    refresh(): Promise<AuthResult | false>;
    login(credentials: AuthCredentials): Promise<AuthResult>;
    static(token: AuthToken): Promise<boolean>;
    logout(): Promise<void>;
}

type DirectusStorageOptions = StorageOptions & {
    mode?: 'LocalStorage' | 'MemoryStorage';
};
type DirectusOptions<IAuthHandler extends IAuth = Auth> = {
    auth?: IAuthHandler | PartialBy<AuthOptions, 'transport' | 'storage'>;
    transport?: ITransport | Partial<TransportOptions>;
    storage?: IStorage | DirectusStorageOptions;
};
declare class Directus<T extends Item, IAuthHandler extends IAuth = Auth> implements IDirectus<T> {
    private _url;
    private _options?;
    private _auth;
    private _transport;
    private _storage;
    private _assets?;
    private _activity?;
    private _collections?;
    private _fields?;
    private _files?;
    private _folders?;
    private _permissions?;
    private _presets?;
    private _relations?;
    private _revisions?;
    private _roles?;
    private _users?;
    private _server?;
    private _utils?;
    private _graphql?;
    private _settings?;
    private _items;
    private _singletons;
    constructor(url: string, options?: DirectusOptions<IAuthHandler>);
    get url(): string;
    get auth(): IAuthHandler;
    get storage(): IStorage;
    get transport(): ITransport;
    get assets(): AssetsHandler;
    get activity(): ActivityHandler<TypeOf<T, 'directus_activity'>>;
    get collections(): CollectionsHandler<TypeOf<T, 'directus_collections'>>;
    get fields(): FieldsHandler<TypeOf<T, 'directus_fields'>>;
    get files(): FilesHandler<TypeOf<T, 'directus_files'>>;
    get folders(): FoldersHandler<TypeOf<T, 'directus_folders'>>;
    get permissions(): PermissionsHandler<TypeOf<T, 'directus_permissions'>>;
    get presets(): PresetsHandler<TypeOf<T, 'directus_presets'>>;
    get relations(): RelationsHandler<TypeOf<T, 'directus_relations'>>;
    get revisions(): RevisionsHandler<TypeOf<T, 'directus_revisions'>>;
    get roles(): RolesHandler<TypeOf<T, 'directus_roles'>>;
    get users(): UsersHandler<TypeOf<T, 'directus_users'>>;
    get settings(): SettingsHandler<TypeOf<T, 'directus_settings'>>;
    get server(): ServerHandler;
    get utils(): UtilsHandler;
    get graphql(): GraphQLHandler;
    singleton<C extends string, I extends Item>(collection: C): ISingleton<I>;
    items<C extends string, I extends Item>(collection: C): IItems<I>;
}

export { ActivityHandler, ActivityItem, ActivityType, Aggregate, AssetsHandler, Auth, AuthCredentials, AuthMode, AuthOptions, AuthResult, AuthStorage, AuthToken, AuthTokenType, BaseStorage, CollectionItem, CollectionMetaTranslationType, CollectionMetaType, CollectionSchemaType, CollectionType, CollectionsHandler, Comment, CommentsHandler, Deep, DeepQueryMany, DefaultItem, DefaultType, Directus, DirectusOptions, DirectusStorageOptions, DirectusTypes, EmptyParamError, Field, FieldFilter, FieldItem, FieldMetaConditionOptionType, FieldMetaConditionType, FieldMetaTranslationType, FieldMetaType, FieldSchemaType, FieldType, FieldsHandler, FileItem, FileType, FilesHandler, Filter, FilterOperators, FolderItem, FolderType, FoldersHandler, IAuth, ID, IDirectus, IDirectusBase, IItems, ISingleton, IStorage, ITransport, InferQueryType, Item, ItemInput, ItemMetadata, ItemsHandler, ItemsOptions, LocalStorage, LogicalFilter, LogicalFilterAnd, LogicalFilterOr, ManyItems, MemoryStorage, Meta, NestedObjectKeys, Omit$1 as Omit, OneItem, OptionalKeys, PartialBy, Payload, PermissionItem, PermissionType, PermissionsHandler, PickedDefaultItem, PresetItem, PresetType, PresetsHandler, QueryFields, QueryMany, QueryOne, RelationItem, RelationMetaType, RelationSchemaType, RelationType, RelationsHandler, RequiredKeys, RevisionItem, RevisionType, RevisionsHandler, RoleItem, RoleType, RolesHandler, ServerHandler, ServerInfo, SettingItem, SettingType, SettingsHandler, SharedAggregate, Sort, StorageOptions, SystemType, TfaType, Transport, TransportError, TransportErrorDescription, TransportMethods, TransportOptions, TransportRequestOptions, TransportResponse, TypeMap, TypeOf, UserItem, UserType, UsersHandler, UtilsHandler };
