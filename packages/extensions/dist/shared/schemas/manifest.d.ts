import { z } from "zod";

//#region src/shared/schemas/manifest.d.ts
declare const ExtensionManifest: z.ZodObject<{
  name: z.ZodString;
  version: z.ZodString;
  type: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<"module">, z.ZodLiteral<"commonjs">]>>;
  description: z.ZodOptional<z.ZodString>;
  icon: z.ZodOptional<z.ZodString>;
  dependencies: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
  devDependencies: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
  "directus:extension": z.ZodIntersection<z.ZodObject<{
    host: z.ZodString;
    hidden: z.ZodOptional<z.ZodBoolean>;
  }, z.core.$strip>, z.ZodUnion<readonly [z.ZodObject<{
    type: z.ZodEnum<{
      interface: "interface";
      display: "display";
      layout: "layout";
      module: "module";
      panel: "panel";
      theme: "theme";
    }>;
    path: z.ZodString;
    source: z.ZodString;
  }, z.core.$strip>, z.ZodObject<{
    type: z.ZodEnum<{
      hook: "hook";
      endpoint: "endpoint";
    }>;
    path: z.ZodString;
    source: z.ZodString;
    sandbox: z.ZodOptional<z.ZodObject<{
      enabled: z.ZodBoolean;
      requestedScopes: z.ZodObject<{
        request: z.ZodOptional<z.ZodObject<{
          urls: z.ZodArray<z.ZodString>;
          methods: z.ZodArray<z.ZodUnion<readonly [z.ZodLiteral<"GET">, z.ZodLiteral<"POST">, z.ZodLiteral<"PATCH">, z.ZodLiteral<"PUT">, z.ZodLiteral<"DELETE">]>>;
        }, z.core.$strip>>;
        log: z.ZodOptional<z.ZodObject<{}, z.core.$strip>>;
        sleep: z.ZodOptional<z.ZodObject<{}, z.core.$strip>>;
      }, z.core.$strip>;
    }, z.core.$strip>>;
  }, z.core.$strip>, z.ZodObject<{
    type: z.ZodEnum<{
      operation: "operation";
    }>;
    path: z.ZodObject<{
      app: z.ZodString;
      api: z.ZodString;
    }, z.core.$strip>;
    source: z.ZodObject<{
      app: z.ZodString;
      api: z.ZodString;
    }, z.core.$strip>;
    sandbox: z.ZodOptional<z.ZodObject<{
      enabled: z.ZodBoolean;
      requestedScopes: z.ZodObject<{
        request: z.ZodOptional<z.ZodObject<{
          urls: z.ZodArray<z.ZodString>;
          methods: z.ZodArray<z.ZodUnion<readonly [z.ZodLiteral<"GET">, z.ZodLiteral<"POST">, z.ZodLiteral<"PATCH">, z.ZodLiteral<"PUT">, z.ZodLiteral<"DELETE">]>>;
        }, z.core.$strip>>;
        log: z.ZodOptional<z.ZodObject<{}, z.core.$strip>>;
        sleep: z.ZodOptional<z.ZodObject<{}, z.core.$strip>>;
      }, z.core.$strip>;
    }, z.core.$strip>>;
  }, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"bundle">;
    partial: z.ZodOptional<z.ZodBoolean>;
    path: z.ZodObject<{
      app: z.ZodString;
      api: z.ZodString;
    }, z.core.$strip>;
    entries: z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
      type: z.ZodEnum<{
        hook: "hook";
        endpoint: "endpoint";
      }>;
      name: z.ZodString;
      source: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
      type: z.ZodEnum<{
        interface: "interface";
        display: "display";
        layout: "layout";
        module: "module";
        panel: "panel";
        theme: "theme";
      }>;
      name: z.ZodString;
      source: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
      type: z.ZodEnum<{
        operation: "operation";
      }>;
      name: z.ZodString;
      source: z.ZodObject<{
        app: z.ZodString;
        api: z.ZodString;
      }, z.core.$strip>;
    }, z.core.$strip>]>>;
  }, z.core.$strip>]>>;
}, z.core.$strip>;
type ExtensionManifest = z.infer<typeof ExtensionManifest>;
//#endregion
export { ExtensionManifest };