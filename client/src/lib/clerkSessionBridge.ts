/**
 * tRPC / 분석 fetch가 Clerk 세션 토큰을 Authorization에 넣기 위해 사용.
 * ClerkProvider 트리 안에서 getToken 등록 (publishable key만 프론트에 존재).
 */
let clerkGetToken: (() => Promise<string | null>) | null = null;

export function registerClerkGetToken(fn: () => Promise<string | null>) {
  clerkGetToken = fn;
}

export async function getClerkBearerHeaders(): Promise<HeadersInit> {
  if (!clerkGetToken) {
    return {};
  }
  const token = await clerkGetToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
