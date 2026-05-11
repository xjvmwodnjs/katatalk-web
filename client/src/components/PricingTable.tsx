// =============================================================
// PricingTable: 크레딧 팩 충전 (Toss Payments / Lemon Squeezy)
// =============================================================

import { useEffect, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Translations, type Language } from "@/lib/mockData";
import { getAnalyzeAuthHeaders } from "@/lib/analyzeAuthHeaders";
import { isCreditChargeCheckoutDisabled } from "@shared/billingUiRules";

export type BillingProviderChoice = "toss" | "lemonsqueezy";

interface PricingTableProps {
  t: Translations;
  lang: Language;
  isAuthenticated: boolean;
  onRequireLogin: () => void;
}

type PackId = "starter" | "standard" | "pro";

const PACKS: {
  id: PackId;
  credits: number;
  labelKo: string;
}[] = [
  { id: "starter", credits: 50, labelKo: "Starter" },
  { id: "standard", credits: 120, labelKo: "Standard" },
  { id: "pro", credits: 300, labelKo: "Pro" },
];

function defaultProviderForLang(lang: Language): BillingProviderChoice {
  return lang === "ko" ? "toss" : "lemonsqueezy";
}

export default function PricingTable({ t, lang, isAuthenticated, onRequireLogin }: PricingTableProps) {
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [provider, setProvider] = useState<BillingProviderChoice>(() => defaultProviderForLang(lang));

  useEffect(() => {
    setProvider(defaultProviderForLang(lang));
  }, [lang]);

  const refundPolicyTextKo =
    "디지털 분석 크레딧은 사용 즉시 차감되며, 이미 사용한 크레딧은 환불되지 않는다는 점에 동의합니다.";
  const refundPolicyNoteKo =
    "TODO: 정식 출시 전 환불 정책 문구는 법적 검토가 필요합니다.";

  const buttonDisabled = isCreditChargeCheckoutDisabled(policyAccepted, checkoutLoading);

  const payButtonLabel =
    provider === "toss"
      ? lang === "ko"
        ? "토스로 결제하기"
        : "Pay with Toss (KR)"
      : "Pay with card";

  const startCheckout = async (packageId: PackId) => {
    if (!isAuthenticated) {
      toast.info("로그인이 필요합니다. 로그인 페이지로 이동합니다.");
      onRequireLogin();
      return;
    }
    if (buttonDisabled) return;

    setCheckoutLoading(true);
    try {
      const headers = await getAnalyzeAuthHeaders();
      const res = await fetch("/api/billing/create-checkout", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ packageId, provider, locale: lang }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        url?: string;
        checkoutPayload?: unknown;
        provider?: string;
        message?: string;
      };
      if (res.status === 401) {
        toast.error("로그인이 필요합니다.", { description: "/login 에서 로그인한 뒤 다시 시도해 주세요." });
        onRequireLogin();
        return;
      }
      if (!res.ok || body.success === false) {
        const msg =
          typeof body.message === "string" && body.message.trim()
            ? body.message
            : "결제를 시작할 수 없습니다. 잠시 후 다시 시도해 주세요.";
        toast.error("결제를 시작할 수 없습니다.", { description: msg });
        return;
      }

      if (typeof body.url === "string" && body.url) {
        window.location.href = body.url;
        return;
      }

      if (body.checkoutPayload) {
        toast.message("테스트 결제 준비 중", {
          description:
            "Toss 결제창·승인 API 연동은 다음 단계에서 완료됩니다. success URL 만으로 크레딧이 오르지 않으며, 웹훅으로만 반영됩니다.",
        });
        return;
      }

      toast.error("결제 정보를 받지 못했습니다.", {
        description: "잠시 후 다시 시도하거나 다른 결제 수단을 선택해 주세요.",
      });
    } catch {
      toast.error("네트워크 오류로 결제를 시작하지 못했습니다.");
    } finally {
      setCheckoutLoading(false);
    }
  };

  return (
    <section className="py-12 md:py-16">
      <div className="text-center mb-10">
        <h2
          className="text-2xl md:text-3xl font-bold text-amber-100 mb-2"
          style={{ fontFamily: "'Noto Serif KR', serif" }}
        >
          {t.pricingTitle}
        </h2>
        <p className="text-sm text-slate-400" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
          {t.pricingSubtitle}
        </p>
      </div>

      <div
        className="max-w-xl mx-auto mb-6 rounded-xl p-4 text-left text-xs space-y-3"
        style={{
          background: "rgba(22, 22, 28, 0.85)",
          border: "1px solid rgba(255,255,255,0.08)",
          fontFamily: "'Noto Sans KR', sans-serif",
        }}
      >
        <p className="text-slate-500">결제 수단</p>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 cursor-pointer text-slate-200">
            <input
              type="radio"
              name="pay-provider"
              checked={provider === "toss"}
              onChange={() => setProvider("toss")}
            />
            한국 결제 (Toss Payments)
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-slate-200">
            <input
              type="radio"
              name="pay-provider"
              checked={provider === "lemonsqueezy"}
              onChange={() => setProvider("lemonsqueezy")}
            />
            해외 결제 (Global card / Lemon Squeezy)
          </label>
        </div>
        <p className="text-[11px] text-slate-500 pt-1">
          기본값: UI 언어가 한국어이면 Toss, 그 외에는 Lemon Squeezy 가 선택됩니다. 연동은 단계적으로 켜집니다.
        </p>
      </div>

      <div
        className="max-w-xl mx-auto mb-8 rounded-xl p-4 text-left text-xs text-slate-400 space-y-2"
        style={{
          background: "rgba(22, 22, 28, 0.85)",
          border: "1px solid rgba(255,255,255,0.08)",
          fontFamily: "'Noto Sans KR', sans-serif",
        }}
      >
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            className="mt-1 rounded border-slate-600"
            checked={policyAccepted}
            onChange={e => setPolicyAccepted(e.target.checked)}
          />
          <span>
            <span className="text-slate-200">{refundPolicyTextKo}</span>
            <span className="block mt-2 text-slate-500">{refundPolicyNoteKo}</span>
          </span>
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-4xl mx-auto">
        {PACKS.map(pack => {
          const isPopular = pack.id === "standard";
          return (
            <div
              key={pack.id}
              className={`relative rounded-2xl overflow-hidden transition-all duration-200 hover:scale-[1.02] ${
                isPopular ? "ring-2 ring-amber-400/50" : ""
              }`}
              style={{
                background: isPopular
                  ? "linear-gradient(180deg, rgba(201,168,76,0.08) 0%, rgba(22,22,28,0.95) 40%)"
                  : "rgba(22, 22, 28, 0.85)",
                border: isPopular
                  ? "1px solid rgba(201, 168, 76, 0.3)"
                  : "1px solid rgba(255,255,255,0.08)",
                backdropFilter: "blur(8px)",
              }}
            >
              {isPopular && (
                <div
                  className="absolute top-0 right-0 px-3 py-1 rounded-bl-lg text-[10px] font-bold flex items-center gap-1"
                  style={{
                    background: "linear-gradient(135deg, #C9A84C, #A08030)",
                    color: "#000",
                  }}
                >
                  <Sparkles className="w-3 h-3" />
                  {t.popular}
                </div>
              )}

              <div className="p-6">
                <h3
                  className="text-lg font-bold text-amber-100 mb-1"
                  style={{ fontFamily: "'Noto Serif KR', serif" }}
                >
                  {pack.labelKo}
                </h3>

                <div className="flex items-baseline gap-1 mb-2">
                  <span
                    className="text-3xl font-bold"
                    style={{
                      color: isPopular ? "#C9A84C" : "#e2e8f0",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {pack.credits}
                  </span>
                  <span className="text-xs text-slate-500">credits</span>
                </div>
                <p className="text-[11px] text-slate-500 mb-6" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
                  결제 금액은 각 결제사(Toss / Lemon Squeezy) 확인 화면에서 표시됩니다.
                </p>

                <ul className="space-y-2.5 mb-6">
                  <li className="flex items-start gap-2">
                    <Check
                      className="w-4 h-4 flex-shrink-0 mt-0.5"
                      style={{ color: isPopular ? "#C9A84C" : "#4ade80" }}
                    />
                    <span className="text-sm text-slate-300" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
                      SGF 분석 1회당 1 크레딧 차감
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check
                      className="w-4 h-4 flex-shrink-0 mt-0.5"
                      style={{ color: isPopular ? "#C9A84C" : "#4ade80" }}
                    />
                    <span className="text-sm text-slate-300" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
                      충전 크레딧은 만료 없이 잔액으로 유지 (정책 변경 시 별도 고지)
                    </span>
                  </li>
                </ul>

                <button
                  type="button"
                  disabled={buttonDisabled}
                  onClick={() => void startCheckout(pack.id)}
                  className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 inline-flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={
                    isPopular
                      ? {
                          background: "linear-gradient(135deg, #C9A84C, #A08030)",
                          color: "#000",
                          boxShadow: "0 4px 16px rgba(201, 168, 76, 0.25)",
                        }
                      : {
                          background: "rgba(201, 168, 76, 0.12)",
                          border: "1px solid rgba(201, 168, 76, 0.3)",
                          color: "#C9A84C",
                        }
                  }
                >
                  {payButtonLabel}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
