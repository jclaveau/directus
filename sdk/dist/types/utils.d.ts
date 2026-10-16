//#region src/types/utils.d.ts
/**
 * Makes types mutable
 */
type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
/**
 * Flatten array types to their singular root
 */
type UnpackList<Item> = Item extends any[] ? Item[number] : Item;
/**
 * Merge two object types with never guard
 */
type Merge<A$1, B, TypeA = NeverToUnknown<A$1>, TypeB = NeverToUnknown<B>> = { [K in keyof TypeA | keyof TypeB]: K extends keyof TypeA & keyof TypeB ? TypeA[K] | TypeB[K] : K extends keyof TypeB ? TypeB[K] : K extends keyof TypeA ? TypeA[K] : never };
/**
 * Fallback never to unknown
 */
type NeverToUnknown<T> = IfNever<T, unknown>;
type IfNever<T, Y, N = T> = [T] extends [never] ? Y : N;
/**
 * Test for any
 */
type IfAny<T, Y, N> = 0 extends 1 & T ? Y : N;
type IsAny<T> = IfAny<T, true, never>;
type IsNullable<T, Y = true, N = never> = T | null extends T ? Y : N;
type IsDateTime<T, Y, N> = T extends 'datetime' ? Y : N;
type IsNumber<T, Y, N> = T extends number ? Y : N;
type IsString<T, Y, N> = T extends string ? Y : N;
/**
 * Helpers for working with unions
 */
type UnionToParm<U> = U extends any ? (k: U) => void : never;
type UnionToSect<U> = UnionToParm<U> extends ((k: infer I) => void) ? I : never;
type ExtractParm<F> = F extends {
  (a: infer A): void;
} ? A : never;
type SpliceOne<Union> = Exclude<Union, ExtractOne<Union>>;
type ExtractOne<Union> = ExtractParm<UnionToSect<UnionToParm<Union>>>;
type ToTuple<Union> = ToTupleRec<Union, []>;
type ToTupleRec<Union, Rslt extends any[]> = SpliceOne<Union> extends never ? [ExtractOne<Union>, ...Rslt] : ToTupleRec<SpliceOne<Union>, [ExtractOne<Union>, ...Rslt]>;
type TupleToUnion<T extends unknown[]> = T[number];
/**
 * Recursively make properties optional
 */
type NestedPartial<Item> = Item extends any[] ? UnpackList<Item> extends infer RawItem ? NestedPartial<RawItem>[] : never : Item extends object ? { [Key in keyof Item]?: NestedUnion<Item[Key]> } : Item;
type NestedUnion<Item> = TupleToUnion<ToTuplePartial<Item>>;
type ToTuplePartial<Union> = ToTuplePartialRec<Union, []>;
type ToTuplePartialRec<Union, Rslt extends any[]> = SpliceOne<Union> extends never ? [NestedPartial<ExtractOne<Union>>, ...Rslt] : ToTuplePartialRec<SpliceOne<Union>, [NestedPartial<ExtractOne<Union>>, ...Rslt]>;
/**
 * Reduces a complex object type to make it readable in IDEs.
 */
type Prettify<T> = { [K in keyof T]: T[K] } & unknown;
//#endregion
export { IfAny, IfNever, IsAny, IsDateTime, IsNullable, IsNumber, IsString, Merge, Mutable, NestedPartial, NeverToUnknown, Prettify, ToTuple, TupleToUnion, UnpackList };
//# sourceMappingURL=utils.d.ts.map