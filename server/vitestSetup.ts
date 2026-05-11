/**
 * Vitest 전역 설정 — 서버 모듈이 로드되기 전에 최소 env 를 채운다.
 */
if (!process.env.JWT_SECRET?.trim()) {
  process.env.JWT_SECRET = "vitest-jwt-secret-minimum-32-characters-long-x";
}
