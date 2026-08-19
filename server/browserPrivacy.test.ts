import { describe, expect, it, vi } from "vitest";
import { purgeDeprecatedBrowserIdentityCache } from "../client/src/lib/browserPrivacy";

describe("browser privacy cleanup", () => {
  it("removes the deprecated identity cache without reading or rewriting it", () => {
    const removeItem = vi.fn();

    purgeDeprecatedBrowserIdentityCache({ removeItem });

    expect(removeItem).toHaveBeenCalledOnce();
    expect(removeItem).toHaveBeenCalledWith("katatalk-runtime-user-info");
  });

  it("does not break authentication when browser storage is blocked", () => {
    expect(() =>
      purgeDeprecatedBrowserIdentityCache({
        removeItem() {
          throw new DOMException("blocked", "SecurityError");
        },
      })
    ).not.toThrow();
  });

  it("does not break authentication when the localStorage getter is blocked", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: Object.defineProperty({}, "localStorage", {
        get() {
          throw new DOMException("blocked", "SecurityError");
        },
      }),
    });

    expect(() => purgeDeprecatedBrowserIdentityCache()).not.toThrow();
  });
});
