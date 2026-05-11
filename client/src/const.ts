export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/** 홈·로그인 등 UI 언어 공유 (Clerk localization 과 동기) */
export type UiLangCode = "ko" | "en" | "zh" | "ja";
export const KATATALK_UI_LANG_KEY = "katatalk-ui-lang";
export const KATATALK_UI_LANG_EVENT = "katatalk-ui-lang-change";

export function readStoredUiLang(): UiLangCode {
  try {
    const v = localStorage.getItem(KATATALK_UI_LANG_KEY);
    if (v === "ko" || v === "en" || v === "zh" || v === "ja") {
      return v;
    }
  } catch {
    /* ignore */
  }
  return "ko";
}

export function persistUiLang(lang: UiLangCode) {
  try {
    localStorage.setItem(KATATALK_UI_LANG_KEY, lang);
    window.dispatchEvent(new Event(KATATALK_UI_LANG_EVENT, { bubbles: false }));
  } catch {
    /* ignore */
  }
}

// Generate login URL at runtime so redirect URI reflects the current origin.
export const getLoginUrl = () => {
  const authProvider = import.meta.env.VITE_AUTH_PROVIDER ?? "local-dev";

  if (authProvider === "supabase" || authProvider === "clerk") {
    return "/login";
  }

  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;

  if (authProvider === "local-dev" || !oauthPortalUrl || !appId) {
    return "/";
  }

  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);

  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  return url.toString();
};
