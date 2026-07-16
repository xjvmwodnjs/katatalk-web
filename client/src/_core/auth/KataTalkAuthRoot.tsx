import { lazy, Suspense, type ReactNode } from "react";
import { KataTalkLegacyAuthProvider } from "./KataTalkLegacyAuthProvider";

let lazyKataTalkClerkAuthProvider: ReturnType<typeof lazy> | null = null;

function getLazyKataTalkClerkAuthProvider() {
  lazyKataTalkClerkAuthProvider ??= lazy(() =>
    import("./KataTalkClerkAuthProvider").then(module => ({
      default: module.KataTalkClerkAuthProvider,
    }))
  );
  return lazyKataTalkClerkAuthProvider;
}

export function KataTalkAuthRoot({ children }: { children: ReactNode }) {
  const clerkMode = import.meta.env.VITE_AUTH_PROVIDER === "clerk";
  if (clerkMode) {
    const LazyKataTalkClerkAuthProvider = getLazyKataTalkClerkAuthProvider();
    return (
      <Suspense fallback={null}>
        <LazyKataTalkClerkAuthProvider>{children}</LazyKataTalkClerkAuthProvider>
      </Suspense>
    );
  }
  return <KataTalkLegacyAuthProvider>{children}</KataTalkLegacyAuthProvider>;
}
