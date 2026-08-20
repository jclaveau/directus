import { RuleTester } from 'eslint'
import tseslint from 'typescript-eslint'
import noSingleUseConst from './no-single-use-const.js'
import noSingleCallerFunction from './no-single-caller-function.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    ecmaVersion: 2022,
    sourceType: `module`,
  },
})

ruleTester.run(`no-single-use-const`, noSingleUseConst, {
  valid: [
    { code: `const twoReads = 1; use(twoReads); use(twoReads)` },
    { code: `export const exportedOnce = 1; use(exportedOnce)` },
    { code: `const neverRead = 1` },
    { code: `const { destructured } = source; use(destructured)` },
    {
      code: `async function outer() { const awaited = await load(); use(awaited) }`,
    },
    {
      code: [
        `function outer() {`,
        `  const crossScope = 1`,
        `  inner()`,
        `  function inner() { use(crossScope) }`,
        `}`,
      ].join(`\n`),
    },
    {
      // Inlining pushes the read's line past the cap, which is what named it.
      code: [
        `function outer() {`,
        `  const sliceQuery = 'fields=id,label,owner&filter[owner][_eq]=' + owner`,
        `  return request(url).get('/items/' + collection + '?' + sliceQuery)`,
        `}`,
      ].join(`\n`),
      options: [{ code: 85, tabWidth: 4 }],
    },
    { code: `const actResult = act(); expect(actResult).toBe(1)` },
    {
      // A read inside a loop still runs once per iteration, but the const is read
      // twice at source level here, so the rule stays quiet.
      code: `const reused = 1; for (const x of xs) { use(reused, x) } use(reused)`,
    },
  ],
  invalid: [
    {
      code: `const singleRead = compute(); use(singleRead)`,
      errors: [{ messageId: `singleUse`, data: { name: `singleRead` } }],
    },
    {
      code: `function outer() { const localOnce = 1; return localOnce }`,
      errors: [{ messageId: `singleUse` }],
    },
    {
      // A multi-line initializer is reported: its shape survives inlining, so the
      // column cap can't be measured and the author decides.
      code: [
        `function outer() {`,
        `  const wideObject = {`,
        `    key: 'value',`,
        `  }`,
        `  return wideObject`,
        `}`,
      ].join(`\n`),
      errors: [{ messageId: `singleUse` }],
    },
    {
      // Awaited, but the exemption is switched off.
      code: `async function outer() { const awaited = await load(); use(awaited) }`,
      options: [{ ignoreAwait: false }],
      errors: [{ messageId: `singleUse` }],
    },
    {
      code: `const actResult = act(); expect(actResult).toBe(1)`,
      options: [{ ignoreAssertedValues: false }],
      errors: [{ messageId: `singleUse` }],
    },
    {
      // The array literal that started this: read once inside a condition.
      code: [
        `function outer(rule) {`,
        `  const ruleList = ['CASCADE', 'SET NULL']`,
        `  return ruleList.includes(rule)`,
        `}`,
      ].join(`\n`),
      errors: [{ messageId: `singleUse`, data: { name: `ruleList` } }],
    },
  ],
})

ruleTester.run(`no-single-caller-function`, noSingleCallerFunction, {
  valid: [
    { code: `function twoCallers() {}; twoCallers(); twoCallers()` },
    { code: `export function exportedOnce() {}; exportedOnce()` },
    { code: `export default function defaultOnce() {}; defaultOnce()` },
    { code: `function neverCalled() {}` },
    {
      // The single reference is the recursive call itself, so there is no caller.
      code: `function recursesOnly(n) { return n > 0 ? recursesOnly(n - 1) : 0 }`,
    },
  ],
  invalid: [
    {
      code: `function onlyCaller() {}; onlyCaller()`,
      errors: [{ messageId: `singleCaller`, data: { name: `onlyCaller` } }],
    },
    {
      // Recursion plus one outside caller is still one caller.
      code: [
        `function recursesAndCalled(n) {`,
        `  return n > 0 ? recursesAndCalled(n - 1) : 0`,
        `}`,
        `recursesAndCalled(3)`,
      ].join(`\n`),
      errors: [{ messageId: `singleCaller` }],
    },
    {
      // Passed by reference rather than called — still one use site.
      code: `function passedOnce() {}; register(passedOnce)`,
      errors: [{ messageId: `singleCaller` }],
    },
  ],
})

console.info(`rule tests passed`)
