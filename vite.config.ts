import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import {
  CLIENT_BUILD_ENV_PREFIXES,
  CLIENT_BUILD_MANIFEST_FILE,
  createClientBuildManifest,
  selectClientBuildEnvironment,
  serializeClientBuildManifest,
  type ClientBuildManifestV1,
} from "./scripts/clientBuildArtifactCore";
import {
  inspectClientBuildGitSource,
  resolveVerifiedClientBuildSourceSha,
} from "./scripts/clientBuildSourceProvenance";

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

  if (
    ["react", "react-dom", "scheduler"].some(packageName =>
      hasNodePackage(normalized, packageName)
    )
  ) {
    return "vendor-react";
  }
  if (hasNodePackage(normalized, "@clerk")) {
    return "vendor-clerk";
  }
  if (
    ["@tanstack", "@trpc", "superjson"].some(packageName =>
      hasNodePackage(normalized, packageName)
    )
  ) {
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

function keepAuthPreloadDependency(
  authProvider: string | undefined,
  dependency: string
): boolean {
  if (authProvider !== "clerk" && dependency.includes("vendor-clerk")) {
    return false;
  }
  if (authProvider !== "supabase" && dependency.includes("vendor-supabase")) {
    return false;
  }
  return true;
}

function clientBuildManifestPlugin(
  manifest: ClientBuildManifestV1 | null
): Plugin {
  return {
    name: "katatalk-client-build-manifest",
    apply: "build",
    generateBundle() {
      if (!manifest) return;
      this.emitFile({
        type: "asset",
        fileName: CLIENT_BUILD_MANIFEST_FILE,
        source: serializeClientBuildManifest(manifest),
      });
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const fileEnv = loadEnv(mode, import.meta.dirname, CLIENT_BUILD_ENV_PREFIXES);
  const buildEnv = selectClientBuildEnvironment(process.env, fileEnv);
  if (command === "build") {
    buildEnv.KATATALK_BUILD_COMMIT_SHA = resolveVerifiedClientBuildSourceSha({
      claimedCommitSha: buildEnv.KATATALK_BUILD_COMMIT_SHA,
      platformEnv: process.env,
      inspection: inspectClientBuildGitSource(import.meta.dirname),
    });
  }
  const authProvider = buildEnv.VITE_AUTH_PROVIDER;
  const clientBuildManifest =
    command === "build" ? createClientBuildManifest(buildEnv) : null;

  return {
    plugins: [
      react(),
      tailwindcss(),
      clientBuildManifestPlugin(clientBuildManifest),
    ],
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
          dependencies.filter(dependency =>
            keepAuthPreloadDependency(authProvider, dependency)
          ),
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
