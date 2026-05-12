import { ENV } from "./env";
import { getServerListenPort } from "./serverListenPort";

const MISMATCH_MESSAGE =
  "APP_BASE_URL의 포트와 현재 개발 서버 포트가 다릅니다. .env의 APP_BASE_URL과 ngrok 대상 포트를 확인해 주세요.";

function effectiveAppBaseUrl(): string {
  return (process.env.APP_BASE_URL?.trim() || ENV.appBaseUrl || "").trim();
}

/** 로컬 http + localhost/127.0.0.1 일 때만 listen 포트와 비교 */
export function getLocalAppBaseUrlListenPortMismatch(): { code: "APP_BASE_URL_PORT_MISMATCH"; message: string } | null {
  if (ENV.isProduction) {
    return null;
  }
  const raw = effectiveAppBaseUrl();
  if (!raw) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:") {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "localhost" && host !== "127.0.0.1") {
    return null;
  }
  const listen = getServerListenPort();
  if (listen == null) {
    return null;
  }
  const urlPort = parsed.port ? parseInt(parsed.port, 10) : 80;
  if (urlPort !== listen) {
    return { code: "APP_BASE_URL_PORT_MISMATCH", message: MISMATCH_MESSAGE };
  }
  return null;
}

export function warnIfAppBaseUrlListenPortMismatch(): void {
  const m = getLocalAppBaseUrlListenPortMismatch();
  if (m) {
    console.warn(`[env] ${m.message} (listen=${getServerListenPort()}, APP_BASE_URL port 불일치)`);
  }
}
