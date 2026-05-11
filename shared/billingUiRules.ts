/**
 * 크레딧 충전 UI — 환불 정책 동의 없이는 결제 진행 불가.
 * (Vitest 에서 버튼 disabled 규칙만 검증할 때 사용)
 */
export function isCreditChargeCheckoutDisabled(policyAccepted: boolean, isLoading: boolean): boolean {
  return !policyAccepted || isLoading;
}
