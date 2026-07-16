import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { analyzeRouter } from "../analyzeRoute";
import { attachPaymentWebhooks, billingRouter } from "../billingRoute";
import { creditsRouter } from "../creditsRoute";
import { createContext } from "./context";
import { ENV, validateServerEnv } from "./env";
import { serveStatic, setupVite } from "./vite";
import { setServerListenPort } from "./serverListenPort";
import { warnIfAppBaseUrlListenPortMismatch } from "./appBaseUrlPortGuard";
import { resolveListenPortForServer } from "./listenPort";
import { registerHealthRoutes } from "./healthRoutes";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  validateServerEnv();

  const app = express();
  if (ENV.isProduction) {
    app.set("trust proxy", 1);
  }
  registerHealthRoutes(app);
  const server = createServer(app);
  // 결제 웹훅: 반드시 express.json() 앞에서 raw body 로 수신
  attachPaymentWebhooks(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  if (ENV.enableLegacyManusStorage) {
    registerStorageProxy(app);
  }

  registerOAuthRoutes(app);
  // Custom API routes
  app.use(billingRouter);
  app.use(creditsRouter);
  app.use(analyzeRouter);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000", 10);
  const port = await resolveListenPortForServer({
    isProduction: ENV.isProduction,
    portFromEnv: preferredPort,
    findAvailablePort,
  });

  if (!ENV.isProduction && port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  setServerListenPort(port);
  warnIfAppBaseUrlListenPortMismatch();

  server.on("error", (err: NodeJS.ErrnoException) => {
    console.error(`[server] listen error on port ${port}:`, err?.message ?? err);
    process.exit(1);
  });

  server.listen(port, () => {
    if (ENV.isProduction) {
      console.log(`Server listening on port ${port}`);
    } else {
      console.log(`Server running on http://localhost:${port}/`);
    }
  });
}

startServer().catch(err => {
  console.error(err);
  process.exit(1);
});
