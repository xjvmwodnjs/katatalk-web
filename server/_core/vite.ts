import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer, type InlineConfig, type UserConfig } from "vite";
import viteConfig from "../../vite.config";

type ViteConfigFactory = (env: {
  command: "serve";
  mode: string;
  isSsrBuild: boolean;
  isPreview: boolean;
}) => UserConfig | Promise<UserConfig>;

async function resolveServerViteConfig(): Promise<InlineConfig> {
  const env = {
    command: "serve" as const,
    mode: process.env.NODE_ENV === "production" ? "production" : "development",
    isSsrBuild: false,
    isPreview: false,
  };
  const config =
    typeof viteConfig === "function" ? (viteConfig as ViteConfigFactory)(env) : viteConfig;
  return (await Promise.resolve(config)) as InlineConfig;
}

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const resolvedViteConfig = await resolveServerViteConfig();
  const vite = await createViteServer({
    ...resolvedViteConfig,
    configFile: false,
    server: {
      ...(resolvedViteConfig.server ?? {}),
      ...serverOptions,
    },
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
