import { createContext, useContext, useMemo, type ReactNode } from "react";
import { translations, type Locale, type L10nKey } from "./translations";

export type { L10nKey };
export interface TFunction {
  (key: L10nKey): string;
}

interface L10nContextValue {
  locale: Locale;
  t: TFunction;
}

const L10nContext = createContext<L10nContextValue | null>(null);

interface L10nProviderProps {
  children: ReactNode;
  locale: Locale;
}

export function L10nProvider({ children, locale }: L10nProviderProps) {
  const value = useMemo<L10nContextValue>(() => {
    return {
      locale,
      t: (key) => translations[locale][key]
    };
  }, [locale]);

  return <L10nContext.Provider value={value}>{children}</L10nContext.Provider>;
}

export function useL10n() {
  const context = useContext(L10nContext);

  if (!context) {
    throw new Error("useL10n must be used inside L10nProvider");
  }

  return context;
}
