import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // GreenGate v8 tenant isolation: service-role clients bypass RLS, so a query that
  // forgets the jurisdiction filter leaks one State's data to another. Force all
  // service-role access through the sanctioned factories in lib/supabase/tenant.ts.
  // `warn` for now (surfaces the ~40 legacy call sites to migrate); flip to `error`
  // once they are all routed through createTenantClient / createPlatformClient.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "**/*.test.{ts,tsx}",
      "**/__tests__/**",
      "src/e2e/**",
      "src/lib/supabase/tenant.ts", // the sanctioned factory itself
    ],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='SUPABASE_SERVICE_ROLE_KEY']",
          message:
            "Do not read SUPABASE_SERVICE_ROLE_KEY directly. Use createTenantClient(jurisdictionId) or createPlatformClient() from @/lib/supabase/tenant — the sanctioned service-role factories (GreenGate v8 tenant isolation).",
        },
      ],
    },
  },
]);

export default eslintConfig;
