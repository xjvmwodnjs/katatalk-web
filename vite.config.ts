import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

function hasNodePackage(id: string, packageName: string): boolean {
  return id.includes(`/node_modules/${packageName}/`);
}

function manualChunks(id: string): string | undefined {
  const normalized = id.replace(/\\/g, "/");
  if (normalized.includes("commonjsHelpers.js")) {
    return "vendor-cjs";
  }
  if (!normalized.includes("/node_modules/")) {
    return undefined;
  }

  if (["react", "react-dom", "scheduler"].some(packageName => hasNodePackage(normalized, packageName))) {
    return "vendor-react";
  }
  if (hasNodePackage(normalized, "@clerk")) {
    return "vendor-clerk";
  }
  if (["@tanstack", "@trpc", "superjson"].some(packageName => hasNodePackage(normalized, packageName))) {
    return "vendor-data";
  }
  if (hasNodePackage(normalized, "@radix-ui")) {
    return "vendor-radix";
  }
  if (hasNodePackage(normalized, "lucide-react")) {
    return "vendor-icons";
  }

  return "vendor-misc";
}

function keepAuthPreloadDependency(authProvider: string | undefined, dependency: string): boolean {
  if (authProvider !== "clerk" && dependency.includes("vendor-clerk")) {
    return false;
  }
  if (authProvider !== "supabase" && dependency.includes("vendor-supabase")) {
    return false;
  }
  return true;
}

export default defineConfig(() => {
  const authProvider = process.env.VITE_AUTH_PROVIDER;

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "client", "src"),
        "@shared": path.resolve(import.meta.dirname, "shared"),
        "@assets": path.resolve(import.meta.dirname, "attached_assets"),
      },
    },
    envDir: path.resolve(import.meta.dirname),
    root: path.resolve(import.meta.dirname, "client"),
    publicDir: path.resolve(import.meta.dirname, "client", "public"),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
      modulePreload: {
        resolveDependencies: (_filename: string, dependencies: string[]) =>
          dependencies.filter(dependency => keepAuthPreloadDependency(authProvider, dependency)),
      },
      rollupOptions: {
        output: {
          manualChunks,
        },
      },
    },
    server: {
      host: true,
      allowedHosts: ["localhost", "127.0.0.1"],
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
    },
  };
});
