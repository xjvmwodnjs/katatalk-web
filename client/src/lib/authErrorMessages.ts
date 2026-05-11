import type { AuthError } from "@supabase/supabase-js";

/**
 * Supabase Auth 에러를 사용자에게 보여줄 한국어 문구로만 변환 (내부 코드·스택 노출 금지)
 */
export function mapAuthErrorToKorean(error: AuthError | Error | null | undefined): string {
  if (!error) {
    return "알 수 없는 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
  }

  const code = "code" in error ? String((error as AuthError).code) : undefined;
  const msg = error.message?.toLowerCase() ?? "";

  switch (code) {
    case "invalid_credentials":
    case "invalid_grant":
      return "이메일 또는 비밀번호가 올바르지 않습니다.";
    case "user_already_registered":
      return "이미 가입된 이메일입니다. 로그인을 시도해 주세요.";
    case "email_not_confirmed":
      return "이메일 인증이 완료되지 않았습니다. 메일함을 확인해 주세요.";
    case "weak_password":
      return "비밀번호가 너무 짧거나 약합니다. 8자 이상으로 설정해 주세요.";
    case "signup_disabled":
      return "현재 회원가입이 비활성화되어 있습니다. 관리자에게 문의해 주세요.";
    default:
      break;
  }

  if (msg.includes("invalid login credentials")) {
    return "이메일 또는 비밀번호가 올바르지 않습니다.";
  }
  if (msg.includes("email rate limit")) {
    return "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (msg.includes("network") || msg.includes("fetch")) {
    return "네트워크 오류가 발생했습니다. 연결을 확인해 주세요.";
  }

  return "요청을 처리할 수 없습니다. 입력 정보를 확인한 뒤 다시 시도해 주세요.";
}
