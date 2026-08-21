// Names an SFC's `<template>` mentions. A binding used from markup is used from an
// AST the script's scope analysis never links to, so both single-use rules have to
// ask the template before deciding a binding has one use — or none.
//
// `ref="el"` and `<style> v-bind(x)` bind by string rather than by expression, so
// they are not identifiers here and stay invisible.
export function vueTemplateIdentifiers(sourceCode) {
  const names = new Set()
  const walked = new Set()

  const walk = (node) => {
    if (!node || typeof node !== `object` || walked.has(node)) {
      return
    }

    walked.add(node)

    if (node.type === `Identifier` && typeof node.name === `string`) {
      names.add(node.name)
    }

    for (const [key, value] of Object.entries(node)) {
      // The parent link would walk back out into the whole document.
      if (key === `parent`) {
        continue
      }

      if (Array.isArray(value)) {
        value.forEach(walk)
      } else if (value && typeof value.type === `string`) {
        walk(value)
      }
    }
  }

  walk(sourceCode.ast.templateBody)

  return names
}
