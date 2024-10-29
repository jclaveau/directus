// src/define-theme.ts
var defineTheme = (theme) => theme;

// src/schema.ts
import { Type } from "@sinclair/typebox";
var Color = Type.String();
var ThemeSchema = Type.Object({
  name: Type.String(),
  appearance: Type.Union([Type.Literal("light"), Type.Literal("dark")]),
  rules: Type.Object({
    foreground: Color
  })
});

// src/store.ts
import { defu } from "defu";
import { defineStore } from "pinia";
import { computed, reactive, ref, unref } from "vue";

// src/themes/dark/default.ts
var default_default = defineTheme({
  name: "Directus Default (Dark)",
  appearance: "dark",
  rules: {
    foreground: "#fff"
  }
});

// src/themes/light/default.ts
var default_default2 = defineTheme({
  name: "Directus Default (Light)",
  appearance: "light",
  rules: {
    foreground: "#000"
  }
});

// src/store.ts
var useThemeStore = defineStore("themes", () => {
  const currentAppearance = ref("light");
  const currentTheme = reactive({
    dark: default_default.name,
    light: default_default2.name
  });
  const themes = reactive({
    dark: [default_default],
    light: [default_default2]
  });
  const registerTheme = (theme) => {
    if (theme.appearance === "dark") {
      themes.dark.push(theme);
    } else {
      themes.light.push(theme);
    }
  };
  const defaultTheme = computed(() => {
    if (unref(currentAppearance) === "dark")
      return default_default;
    return default_default2;
  });
  const rules = computed(() => {
    const appearance = unref(currentAppearance);
    const theme = themes[appearance].find(({ name }) => name === currentTheme[unref(currentAppearance)]);
    return defu(theme?.rules, unref(defaultTheme).rules);
  });
  return { themes, registerTheme, currentTheme, currentAppearance, rules };
});
export {
  ThemeSchema,
  defineTheme,
  useThemeStore
};
