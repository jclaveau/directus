import { createRequire } from 'node:module'
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

// Resolved through eslint-plugin-vue's own dependency rather than added as a direct
// one: the SFC cases are the only thing here that needs it.
const vueParser = createRequire(import.meta.resolve(`eslint-plugin-vue`))(
  `vue-eslint-parser`,
)

const sfcRuleTester = new RuleTester({
  languageOptions: {
    parser: vueParser,
    parserOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: `module`,
    },
  },
})

function sfc(script, template) {
  return [
    `<template>`,
    `  ${template}`,
    `</template>`,
    `<script setup lang="ts">`,
    script,
    `</script>`,
  ].join(`\n`)
}

ruleTester.run(`no-single-use-const`, noSingleUseConst, {
  valid: [
    { code: `const twoReads = 1; use(twoReads); use(twoReads)` },
    { code: `const neverRead = 1` },
    {
      // The export list is not a read, so this one is used zero times, not once.
      code: `const onlyExported = 1; export { onlyExported }`,
    },
    { code: `const onlyDefault = 1; export default onlyDefault` },
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
    {
      // Inlining would run the initializer once per iteration instead of once.
      code: `function o(ys) { const x = f(); for (const y of ys) { use(x, y) } }`,
    },
    {
      // Inlining would make the initializer conditional: it may never run at all.
      code: `function o(c) { const x = f(); if (c) { use(x) } }`,
    },
    {
      // Same hazard through a short-circuit rather than a statement.
      code: `function o(c) { const x = f(); return c && use(x) }`,
    },
    {
      // Inlining into the `try` would hand the initializer that catch clause.
      code: `function o() { const x = f(); try { use(x) } catch {} }`,
    },
    {
      code: `function o(k) { const x = f(); switch (k) { case 1: use(x) } }`,
    },
  ],
  invalid: [
    {
      code: `const singleRead = compute(); use(singleRead)`,
      errors: [{ messageId: `singleUse`, data: { name: `singleRead` } }],
    },
    {
      // Exported, but with exactly one reader here: the export does not add one.
      code: `export const exportedOnce = 1; use(exportedOnce)`,
      errors: [{ messageId: `singleUse`, data: { name: `exportedOnce` } }],
    },
    {
      code: `const listed = 1; use(listed); export { listed }`,
      errors: [{ messageId: `singleUse`, data: { name: `listed` } }],
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
    {
      // Declaration and read share a line. Measuring the line as it stands puts the
      // pair at 72 columns and the projection at 59, so counting the declaration
      // that the inlining removes would wrongly suppress this one.
      code: `function o() { const q = '${`a`.repeat(30)}'; return g(q) }`,
      options: [{ code: 85, tabWidth: 4 }],
      errors: [{ messageId: `singleUse`, data: { name: `q` } }],
    },
  ],
})

sfcRuleTester.run(`no-single-use-const in an SFC`, noSingleUseConst, {
  valid: [
    {
      // `<script setup>` marks every top-level binding as read at its declaration so
      // a template-only one is not reported unused. That marker is not a use.
      filename: `Comp.vue`,
      code: sfc(`const label = compute()`, `<b>{{ label }}</b>`),
    },
    {
      // `ref="el"` binds by string, so the template never mentions `el` as an
      // identifier and only the declaration marker is left to count.
      filename: `Comp.vue`,
      code: sfc(`const el = ref(null)`, `<b ref="el" />`),
    },
    {
      // One script read, but the template needs the binding: deleting it would leave
      // the markup pointing at nothing.
      filename: `Comp.vue`,
      code: sfc(
        `const rows = load()\nconst total = rows.length`,
        `<b>{{ rows }}{{ total }}</b>`,
      ),
    },
  ],
  invalid: [
    {
      // The control: one real read and the template never mentions it.
      filename: `Comp.vue`,
      code: sfc(
        `const inner = compute()\nconst shown = wrap(inner)`,
        `<b>{{ shown }}</b>`,
      ),
      errors: [{ messageId: `singleUse`, data: { name: `inner` } }],
    },
  ],
})

ruleTester.run(`no-single-caller-function`, noSingleCallerFunction, {
  valid: [
    { code: `function twoCallers() {}; twoCallers(); twoCallers()` },
    {
      // The export list is not a call, so this one has zero callers, not one.
      code: `function onlyExported() {}; export { onlyExported }`,
    },
    { code: `function onlyDefault() {}; export default onlyDefault` },
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
      // Exported, but with exactly one caller here: the export does not add one.
      code: `export function exportedOnce() {}; exportedOnce()`,
      errors: [{ messageId: `singleCaller`, data: { name: `exportedOnce` } }],
    },
    {
      code: `function listed() {}; listed(); export { listed }`,
      errors: [{ messageId: `singleCaller`, data: { name: `listed` } }],
    },
    {
      code: `export default function defaultOnce() {}; defaultOnce()`,
      errors: [{ messageId: `singleCaller`, data: { name: `defaultOnce` } }],
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
    {
      // Reviewed and kept: a type position is still the one and only use, even
      // though it is the one use you cannot literally inline a body into.
      code: `function typedOnce() {}; type Signature = typeof typedOnce`,
      errors: [{ messageId: `singleCaller`, data: { name: `typedOnce` } }],
    },
  ],
})

sfcRuleTester.run(`no-single-caller-function in an SFC`, noSingleCallerFunction, {
  valid: [
    {
      // Called from the script and from the template: two callers, not one.
      filename: `Comp.vue`,
      code: sfc(`function go() {}\nfunction wrap() { go() }\nuse(wrap)\nuse(wrap)`,
        `<b @click="go()" />`),
    },
  ],
  invalid: [
    {
      // The template call is the single caller — counted, where it used to make the
      // whole component exempt.
      filename: `Comp.vue`,
      code: sfc(`function onPick() {}`, `<b @click="onPick()" />`),
      errors: [{ messageId: `singleCaller`, data: { name: `onPick` } }],
    },
  ],
})

console.info(`rule tests passed`)
