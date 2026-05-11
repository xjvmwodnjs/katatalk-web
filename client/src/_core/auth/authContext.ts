import { createContext } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";

export type AuthMeUser = inferRouterOutputs<AppRouter>["auth"]["me"];

export type KataTalkAuthContextValue = {
  user: AuthMeUser;
  loading: boolean;
  error: Error | null;
  isAuthenticated: boolean;
  logout: () => Promise<void>;
  refresh: () => void | Promise<void>;
};

export const KataTalkAuthContext = createContext<KataTalkAuthContextValue | null>(null);
