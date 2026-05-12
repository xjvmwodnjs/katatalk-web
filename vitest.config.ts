import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["server/vitestSetup.ts"],
    include: ["server/**/*.test.ts", "server/**/*.spec.ts"],
    /** vi.mock 이 테스트 파일 간에 섞이지 않도록 프로세스 분리 */
    pool: "forks",
  },
});
