export const AUTH_DEPENDENCY_UNAVAILABLE_CODE =
  "AUTH_DEPENDENCY_UNAVAILABLE" as const;

export const AUTH_DEPENDENCY_UNAVAILABLE_MESSAGE =
  "인증 서비스를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.";

/**
 * A valid request could not be authenticated because a server-side auth
 * dependency or configuration was unavailable. The message is deliberately
 * fixed so upstream provider details and credentials never reach clients.
 */
export class AuthDependencyUnavailableError extends Error {
  readonly code = AUTH_DEPENDENCY_UNAVAILABLE_CODE;

  constructor() {
    super(AUTH_DEPENDENCY_UNAVAILABLE_CODE);
    this.name = "AuthDependencyUnavailableError";
  }
}
