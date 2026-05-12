/**
 * 크레딧 팩 표시용 메타데이터 — 서버 `getCreditAmountForPackage` 와 수량·가격 라벨이 일치해야 합니다.
 * (Lemon Squeezy 대시보드 variant 실제 가격은 운영에서 별도 검증)
 */
export type CreditPackId = "starter" | "standard" | "pro";

export const CREDIT_PACK_ORDER: readonly CreditPackId[] = ["starter", "standard", "pro"];

export const CREDIT_PACK_CREDITS: Record<CreditPackId, number> = {
  starter: 20,
  standard: 50,
  pro: 200,
};

/** UI 표시용 USD 가격 문자열 (결제 금액은 결제사 확인 화면 기준) */
export const CREDIT_PACK_PRICE_USD_LABEL: Record<CreditPackId, string> = {
  starter: "$4.99",
  standard: "$9.99",
  pro: "$29.99",
};

export function creditPackRowsForDisplay(): { id: CreditPackId; credits: number; priceUsd: string }[] {
  return CREDIT_PACK_ORDER.map(id => ({
    id,
    credits: CREDIT_PACK_CREDITS[id],
    priceUsd: CREDIT_PACK_PRICE_USD_LABEL[id],
  }));
}
