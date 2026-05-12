/**
 * 크레딧 충전 UI — 로딩 중이거나(로그인 후) 환불 정책 미동의 시 결제 진행 불가.
 * 비로그인 시에는 버튼을 눌러 로그인 유도가 가능하도록 비활성화하지 않습니다.
 */
export function isCreditChargeCheckoutDisabled(
  policyAccepted: boolean,
  isLoading: boolean,
  isAuthenticated: boolean
): boolean {
  if (isLoading) return true;
  if (!isAuthenticated) return false;
  return !policyAccepted;
}
