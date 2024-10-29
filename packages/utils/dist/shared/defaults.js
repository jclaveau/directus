/**
 * Returns the input source object with the defaults applied
 *
 * @example
 * ```js
 * type Example = {
 * 	optional?: boolean;
 * 	required: boolean;
 * }
 * const input: Example = { required: true };
 * const output = defaults(input, { optional: false });
 * // => { required: true, optional: false }
 * ```
 */
export const defaults = (obj, def) => {
    const input = Object.fromEntries(Object.entries(obj).filter(([_key, value]) => value !== undefined));
    return {
        ...def,
        ...input,
    };
};
