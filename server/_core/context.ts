import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { AUTH_DEPENDENCY_UNAVAILABLE_CODE } from "./authErrors";
import { tryResolveUserFromRequest } from "./resolveRequestUser";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  authError?: typeof AUTH_DEPENDENCY_UNAVAILABLE_CODE;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  let authError: typeof AUTH_DEPENDENCY_UNAVAILABLE_CODE | undefined;

  try {
    user = await tryResolveUserFromRequest(opts.req);
  } catch {
    console.error(`[trpc auth] ${AUTH_DEPENDENCY_UNAVAILABLE_CODE}`);
    authError = AUTH_DEPENDENCY_UNAVAILABLE_CODE;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    authError,
  };
}
