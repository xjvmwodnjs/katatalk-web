import type { ReactNode } from "react";
import { KataTalkClerkAuthProvider } from "./KataTalkClerkAuthProvider";
import { KataTalkLegacyAuthProvider } from "./KataTalkLegacyAuthProvider";

export function KataTalkAuthRoot({ children }: { children: ReactNode }) {
  const clerkMode = import.meta.env.VITE_AUTH_PROVIDER === "clerk";
  if (clerkMode) {
    return <KataTalkClerkAuthProvider>{children}</KataTalkClerkAuthProvider>;
  }
  return <KataTalkLegacyAuthProvider>{children}</KataTalkLegacyAuthProvider>;
}
