import { KATATALK_UI_LANG_EVENT, readStoredUiLang, type UiLangCode } from "@/const";
import { ClerkProvider } from "@clerk/clerk-react";
import { enUS, jaJP, koKR, zhCN } from "@clerk/localizations";
import { dark } from "@clerk/themes";
import { useEffect, useState, type ReactNode } from "react";

const CLERK_LOCALIZATION: Record<UiLangCode, typeof koKR> = {
  ko: koKR,
  en: enUS,
  zh: zhCN,
  ja: jaJP,
};

export function ClerkProviderShell({
  children,
  publishableKey,
}: {
  children: ReactNode;
  publishableKey: string;
}) {
  const [uiLang, setUiLang] = useState<UiLangCode>(() =>
    typeof window !== "undefined" ? readStoredUiLang() : "ko"
  );

  useEffect(() => {
    const sync = () => setUiLang(readStoredUiLang());
    window.addEventListener(KATATALK_UI_LANG_EVENT, sync);
    return () => window.removeEventListener(KATATALK_UI_LANG_EVENT, sync);
  }, []);

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      localization={CLERK_LOCALIZATION[uiLang]}
      afterSignInUrl="/"
      afterSignUpUrl="/"
      afterSignOutUrl="/login"
      signInUrl="/login"
      signUpUrl="/sign-up"
      appearance={{
        baseTheme: dark,
        variables: {
          colorPrimary: "#C9A84C",
          colorBackground: "#16161c",
          colorInputBackground: "rgba(255,255,255,0.08)",
          colorInputText: "#fafafa",
          colorText: "#f4f4f5",
          colorTextSecondary: "#a1a1aa",
          colorNeutral: "#71717a",
          colorDanger: "#fca5a5",
          colorSuccess: "#86efac",
          borderRadius: "12px",
          fontFamily: "'Noto Sans KR', system-ui, sans-serif",
        },
        elements: {
          rootBox: "w-full",
          card: "border border-white/10 bg-zinc-900/95 shadow-2xl",
          headerTitle: "text-amber-50 font-semibold",
          headerSubtitle: "text-zinc-400",
          socialButtonsBlockButton:
            "rounded-xl border border-white/15 bg-white/5 text-zinc-100 hover:bg-white/12 focus-visible:ring-2 focus-visible:ring-amber-400/45",
          formButtonPrimary:
            "rounded-xl font-semibold text-stone-950 shadow-md hover:brightness-110 focus-visible:ring-2 focus-visible:ring-amber-400/55 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
          formFieldInput:
            "rounded-xl border-white/18 bg-zinc-950/90 text-white caret-amber-300 placeholder:text-zinc-400 focus:border-amber-500/45 focus:shadow-[0_0_0_1px_rgba(250,204,21,0.25)]",
          formFieldLabel: "text-zinc-200 font-medium",
          formFieldHintText: "text-zinc-400",
          formFieldErrorText: "text-red-300",
          dividerText: "text-zinc-400",
          dividerLine: "bg-zinc-600",
          footerActionLink:
            "text-amber-200 hover:text-amber-100 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 rounded-sm",
          identityPreviewText: "text-zinc-200",
          alternativeMethodsBlockButton:
            "rounded-xl border border-white/12 bg-white/5 text-zinc-100 hover:bg-white/10",
          formFieldInputShowPasswordButton: "text-zinc-300 hover:text-white",
          otpCodeFieldInput:
            "text-white caret-amber-300 border-white/20 bg-zinc-950/90 placeholder:text-zinc-400",
        },
      }}
    >
      {children}
    </ClerkProvider>
  );
}
