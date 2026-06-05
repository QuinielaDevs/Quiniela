import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

// Vitest config con dos proyectos diferenciados:
//   - unit:        lógica pura + componentes (jsdom). NO toca la DB.
//   - integration: corre contra el Supabase local (entorno node).
// Los specs de Playwright (tests/e2e) se EXCLUYEN explícitamente para que
// Vitest no intente ejecutarlos.
export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          include: [
            "tests/unit/**/*.{test,spec}.{ts,tsx}",
            "src/**/*.{test,spec}.{ts,tsx}",
          ],
          exclude: [
            "tests/e2e/**",
            "tests/integration/**",
            "node_modules/**",
            ".next/**",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          setupFiles: ["./tests/integration/setup-env.ts"],
          include: ["tests/integration/**/*.{test,spec}.ts"],
          exclude: [
            "tests/e2e/**",
            "tests/integration/setup.ts",
            "tests/integration/setup-env.ts",
            "node_modules/**",
            ".next/**",
          ],
          // Las pruebas de integración hacen I/O de red contra Supabase local.
          testTimeout: 30000,
          hookTimeout: 30000,
          fileParallelism: false,
        },
      },
    ],
  },
});
