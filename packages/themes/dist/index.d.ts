import * as _sinclair_typebox from '@sinclair/typebox';
import { Static } from '@sinclair/typebox';
import * as pinia from 'pinia';
import * as vue from 'vue';

/** CSS size, f.e. px, em, % */
/** CSS font weight, f.e. 700, bold */
/** CSS font family, f.e. 'Comic Sans, MS', 'Roboto' */
declare const ThemeSchema: _sinclair_typebox.TObject<{
    name: _sinclair_typebox.TString;
    appearance: _sinclair_typebox.TUnion<[_sinclair_typebox.TLiteral<"light">, _sinclair_typebox.TLiteral<"dark">]>;
    rules: _sinclair_typebox.TObject<{
        foreground: _sinclair_typebox.TString;
    }>;
}>;
type Theme = Static<typeof ThemeSchema>;

declare const defineTheme: (theme: Theme) => {
    name: string;
    appearance: "light" | "dark";
    rules: {
        foreground: string;
    };
};

declare const useThemeStore: pinia.StoreDefinition<"themes", pinia._UnwrapAll<Pick<{
    themes: {
        dark: {
            name: string;
            appearance: "light" | "dark";
            rules: {
                foreground: string;
            };
        }[];
        light: {
            name: string;
            appearance: "light" | "dark";
            rules: {
                foreground: string;
            };
        }[];
    };
    registerTheme: (theme: Theme) => void;
    currentTheme: {
        dark: string;
        light: string;
    };
    currentAppearance: vue.Ref<"light" | "dark">;
    rules: vue.ComputedRef<{
        foreground: string;
    }>;
}, "themes" | "currentTheme" | "currentAppearance">>, Pick<{
    themes: {
        dark: {
            name: string;
            appearance: "light" | "dark";
            rules: {
                foreground: string;
            };
        }[];
        light: {
            name: string;
            appearance: "light" | "dark";
            rules: {
                foreground: string;
            };
        }[];
    };
    registerTheme: (theme: Theme) => void;
    currentTheme: {
        dark: string;
        light: string;
    };
    currentAppearance: vue.Ref<"light" | "dark">;
    rules: vue.ComputedRef<{
        foreground: string;
    }>;
}, "rules">, Pick<{
    themes: {
        dark: {
            name: string;
            appearance: "light" | "dark";
            rules: {
                foreground: string;
            };
        }[];
        light: {
            name: string;
            appearance: "light" | "dark";
            rules: {
                foreground: string;
            };
        }[];
    };
    registerTheme: (theme: Theme) => void;
    currentTheme: {
        dark: string;
        light: string;
    };
    currentAppearance: vue.Ref<"light" | "dark">;
    rules: vue.ComputedRef<{
        foreground: string;
    }>;
}, "registerTheme">>;

export { Theme, ThemeSchema, defineTheme, useThemeStore };
