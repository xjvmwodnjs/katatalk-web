const DEPRECATED_RUNTIME_USER_INFO_KEY = "katatalk-runtime-user-info";

/** Removes the pre-launch identity cache that could contain a name or email. */
export function purgeDeprecatedBrowserIdentityCache(
  storage?: Pick<Storage, "removeItem"> | null
): void {
  let target = storage;
  if (target === undefined) {
    try {
      target = typeof window === "undefined" ? null : window.localStorage;
    } catch {
      return;
    }
  }
  if (!target) return;

  try {
    target.removeItem(DEPRECATED_RUNTIME_USER_INFO_KEY);
  } catch {
    // Authentication must not fail when storage is unavailable or blocked.
  }
}
