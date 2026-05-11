// =============================================================
// PricingTable: Three-tier pricing cards (Free, Basic, Premium)
// =============================================================

import { Check, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Translations } from "@/lib/mockData";

interface PricingTableProps {
  t: Translations;
}

export default function PricingTable({ t }: PricingTableProps) {
  const plans = [
    {
      name: t.free,
      price: "$0",
      features: t.pricingFeatures.free,
      isCurrent: true,
      isPopular: false,
    },
    {
      name: t.basic,
      price: "$4.99",
      features: t.pricingFeatures.basic,
      isCurrent: false,
      isPopular: true,
    },
    {
      name: t.premium,
      price: "$11.99",
      features: t.pricingFeatures.premium,
      isCurrent: false,
      isPopular: false,
    },
  ];

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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-4xl mx-auto">
        {plans.map((plan, idx) => (
          <div
            key={idx}
            className={`relative rounded-2xl overflow-hidden transition-all duration-200 hover:scale-[1.02] ${
              plan.isPopular ? "ring-2 ring-amber-400/50" : ""
            }`}
            style={{
              background: plan.isPopular
                ? "linear-gradient(180deg, rgba(201,168,76,0.08) 0%, rgba(22,22,28,0.95) 40%)"
                : "rgba(22, 22, 28, 0.85)",
              border: plan.isPopular
                ? "1px solid rgba(201, 168, 76, 0.3)"
                : "1px solid rgba(255,255,255,0.08)",
              backdropFilter: "blur(8px)",
            }}
          >
            {/* Popular badge */}
            {plan.isPopular && (
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
              {/* Plan name */}
              <h3
                className="text-lg font-bold text-amber-100 mb-1"
                style={{ fontFamily: "'Noto Serif KR', serif" }}
              >
                {plan.name}
              </h3>

              {/* Price */}
              <div className="flex items-baseline gap-1 mb-6">
                <span
                  className="text-3xl font-bold"
                  style={{
                    color: plan.isPopular ? "#C9A84C" : "#e2e8f0",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  {plan.price}
                </span>
                {plan.price !== "$0" && (
                  <span className="text-xs text-slate-500">{t.perMonth}</span>
                )}
              </div>

              {/* Features */}
              <ul className="space-y-2.5 mb-6">
                {plan.features.map((feature, fi) => (
                  <li key={fi} className="flex items-start gap-2">
                    <Check
                      className="w-4 h-4 flex-shrink-0 mt-0.5"
                      style={{ color: plan.isPopular ? "#C9A84C" : "#4ade80" }}
                    />
                    <span
                      className="text-sm text-slate-300"
                      style={{ fontFamily: "'Noto Sans KR', sans-serif" }}
                    >
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>

              {/* CTA Button */}
              <button
                onClick={() => toast.info("Feature coming soon")}
                className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all duration-200"
                style={
                  plan.isCurrent
                    ? {
                        background: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "#94a3b8",
                      }
                    : plan.isPopular
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
                {plan.isCurrent ? t.currentPlan : t.choosePlan}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
