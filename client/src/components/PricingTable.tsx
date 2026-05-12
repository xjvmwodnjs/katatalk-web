// =============================================================
// PricingTable: 크레딧 팩 충전 (Lemon Squeezy 전용 — 현재 단계)
// =============================================================

import { useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Translations } from "@/lib/mockData";
import { getAnalyzeAuthHeaders } from "@/lib/analyzeAuthHeaders";
import { isCreditChargeCheckoutDisabled } from "@shared/billingUiRules";

interface PricingTableProps {
  t: Translations;
  isAuthenticated: boolean;
  onRequireLogin: () => void;
}

type PackId = "starter" | "standard" | "pro";

/** 크레딧 수량·USD 가격은 서버 `server/paymentProviders/packages.ts` 와 일치해야 함 */
const PACKS: { id: PackId; credits: number; priceUsd: string }[] = [
  { id: "starter", credits: 20, priceUsd: "$4.99" },
  { id: "standard", credits: 50, priceUsd: "$9.99" },
  { id: "pro", credits: 200, priceUsd: "$29.99" },
];

function packDisplayName(id: PackId, t: Translations): string {
  switch (id) {
    case "starter":
      return t.creditPackStarter;
    case "standard":
      return t.creditPackStandard;
    case "pro":
      return t.creditPackPro;
    default:
      return id;
  }
}

export default function PricingTable({ t, isAuthenticated, onRequireLogin }: PricingTableProps) {
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const buttonDisabled = isCreditChargeCheckoutDisabled(policyAccepted, checkoutLoading, isAuthenticated);

  const startCheckout = async (packageId: PackId) => {
    if (!isAuthenticated) {
      toast.info(t.creditCheckoutLoginTitle, { description: t.creditCheckoutLoginDesc });
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
        body: JSON.stringify({ packageId, provider: "lemonsqueezy" }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        url?: string;
        message?: string;
      };
      if (res.status === 401) {
        toast.error(t.loginRequired, { description: t.pricing401Description });
        onRequireLogin();
        return;
      }
      if (!res.ok || body.success === false) {
        const msg =
          typeof body.message === "string" && body.message.trim()
            ? body.message
            : t.pricingCheckoutFailedDesc;
        toast.error(t.pricingCheckoutFailedTitle, { description: msg });
        return;
      }

      if (typeof body.url === "string" && body.url) {
        toast.message(t.pricingCheckoutRedirecting);
        window.location.href = body.url;
        return;
      }

      toast.error(t.pricingCheckoutUrlError, {
        description: t.pricingCheckoutServerErrorDetail,
      });
    } catch {
      toast.error(t.pricingNetworkError);
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
        <p className="text-sm text-slate-400">{t.pricingSubtitle}</p>
      </div>

      <div
        className="max-w-xl mx-auto mb-8 rounded-xl p-4 text-left text-xs text-slate-400 space-y-2"
        style={{
          background: "rgba(22, 22, 28, 0.85)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <p className="text-[11px] text-slate-500">{t.creditRefundMustAgree}</p>
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            className="mt-1 rounded border-slate-600"
            checked={policyAccepted}
            onChange={e => setPolicyAccepted(e.target.checked)}
          />
          <span>
            <span className="text-slate-200">{t.creditRefundPolicyAck}</span>
            <span className="block mt-2 text-slate-500">{t.creditRefundLegalTodo}</span>
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
                <h3 className="text-lg font-bold text-amber-100 mb-1" style={{ fontFamily: "'Noto Serif KR', serif" }}>
                  {packDisplayName(pack.id, t)}
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
                  <span className="text-xs text-slate-500">{t.creditsUnit}</span>
                </div>
                <p className="text-sm font-medium text-slate-300 mb-1" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                  {pack.priceUsd}
                </p>
                <p className="text-[11px] text-slate-500 mb-6">{t.pricingPriceCheckoutNote}</p>

                <ul className="space-y-2.5 mb-6">
                  <li className="flex items-start gap-2">
                    <Check
                      className="w-4 h-4 flex-shrink-0 mt-0.5"
                      style={{ color: isPopular ? "#C9A84C" : "#4ade80" }}
                    />
                    <span className="text-sm text-slate-300">{t.creditBulletPerSgf}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check
                      className="w-4 h-4 flex-shrink-0 mt-0.5"
                      style={{ color: isPopular ? "#C9A84C" : "#4ade80" }}
                    />
                    <span className="text-sm text-slate-300">{t.creditBulletBalancePersistent}</span>
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
                  {t.pricingCheckoutButton}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
