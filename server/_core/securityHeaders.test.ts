import express from "express";
import http from "http";
import { afterEach, describe, expect, it } from "vitest";
import { createBaselineSecurityHeaders } from "./securityHeaders";
import {
  createJsonBodyParser,
  createUrlEncodedBodyParser,
} from "./requestBodyLimits";

async function withServer(
  app: express.Express,
  run: (baseUrl: string) => Promise<void>
): Promise<void> {
  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    await run(`http://127.0.0.1:${String(port)}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
  }
}

describe("baseline security headers", () => {
  it("sets safe headers on every Web response and enables HSTS only in production", async () => {
    const app = express();
    app.use(createBaselineSecurityHeaders({ isProduction: true }));
    app.get("/", (_req, res) => res.json({ ok: true }));

    await withServer(app, async baseUrl => {
      const response = await fetch(baseUrl);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("referrer-policy")).toBe(
        "strict-origin-when-cross-origin"
      );
      expect(response.headers.get("permissions-policy")).toBe(
        "camera=(), microphone=(), geolocation=()"
      );
      expect(response.headers.get("strict-transport-security")).toBe(
        "max-age=31536000"
      );
      expect(response.headers.get("x-powered-by")).toBeNull();
    });
  });

  it("does not set HSTS in local development", async () => {
    const app = express();
    app.use(createBaselineSecurityHeaders());
    app.get("/", (_req, res) => res.sendStatus(204));

    await withServer(app, async baseUrl => {
      const response = await fetch(baseUrl);
      expect(response.headers.get("strict-transport-security")).toBeNull();
    });
  });
});

describe("public request body limits", () => {
  it("rejects oversized API JSON and URL-encoded payloads", async () => {
    const app = express();
    app.use("/api", createJsonBodyParser());
    app.use("/api", createUrlEncodedBodyParser());
    app.post("/api/json", (_req, res) => res.sendStatus(204));
    app.post("/api/form", (_req, res) => res.sendStatus(204));

    await withServer(app, async baseUrl => {
      const jsonResponse = await fetch(`${baseUrl}/api/json`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload: "a".repeat(1_100_000) }),
      });
      expect(jsonResponse.status).toBe(413);

      const formResponse = await fetch(`${baseUrl}/api/form`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `payload=${"a".repeat(40_000)}`,
      });
      expect(formResponse.status).toBe(413);
    });
  });

  it("preserves a preceding raw-body webhook route", async () => {
    const app = express();
    app.post(
      "/api/billing/webhook/test",
      express.raw({ type: "*/*" }),
      (req, res) => {
        res.json({
          raw: Buffer.isBuffer(req.body),
          bytes: Buffer.isBuffer(req.body) ? req.body.length : 0,
        });
      }
    );
    app.use("/api", createJsonBodyParser());
    app.use("/api", createUrlEncodedBodyParser());

    await withServer(app, async baseUrl => {
      const body = '{"event":"order_created"}';
      const response = await fetch(`${baseUrl}/api/billing/webhook/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        raw: true,
        bytes: Buffer.byteLength(body),
      });
    });
  });
});
