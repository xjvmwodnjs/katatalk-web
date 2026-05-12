/** HTTP 서버가 실제로 listen 중인 포트 (로컬 APP_BASE_URL 검증용). Vitest·미기동 시 null. */
let serverListenPort: number | null = null;

export function setServerListenPort(port: number): void {
  serverListenPort = port;
}

export function getServerListenPort(): number | null {
  return serverListenPort;
}

export function clearServerListenPort(): void {
  serverListenPort = null;
}
