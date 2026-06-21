import {
  CalendarDays,
  ClipboardList,
  FileText,
  Home,
  Search,
  Smartphone,
  UserPlus,
  type LucideIcon
} from "lucide-react";
import { motion } from "framer-motion";
import type { L10nKey } from "@/frontend/shared/i18n/L10nProvider";
import { useL10n } from "@/frontend/shared/i18n/L10nProvider";
import type { MobileRouteKey } from "./MobileShell";

interface MobileDashboardAction {
  icon: LucideIcon;
  labelKey: L10nKey;
  route: MobileRouteKey;
}

const actions: MobileDashboardAction[] = [
  { route: "newPatient", icon: UserPlus, labelKey: "mobileNewPatient" },
  { route: "agenda", icon: CalendarDays, labelKey: "mobileAgenda" },
  { route: "searchPatient", icon: Search, labelKey: "mobileSearchPatient" },
  { route: "clinical", icon: ClipboardList, labelKey: "mobileClinical" },
  { route: "consents", icon: FileText, labelKey: "mobileConsents" },
  { route: "deviceStatus", icon: Smartphone, labelKey: "mobileDeviceStatus" }
];

interface MobileDashboardProps {
  onRouteChange: (route: MobileRouteKey) => void;
}

export function MobileDashboard({ onRouteChange }: MobileDashboardProps) {
  const { t } = useL10n();
  const showInstallHint = shouldShowInstallHint();

  return (
    <section className="grid gap-3 sm:grid-cols-2">
      {showInstallHint ? (
        <div className="rounded-xl border border-powder-blue-500/25 bg-glaucous-950 p-4 shadow-[0_18px_48px_rgba(0,0,0,0.22)] sm:col-span-2">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-powder-blue-500/30 bg-powder-blue-950 text-powder-blue-500">
              <Home aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
            </span>
            <div>
              <p className="text-sm font-semibold text-white">{t("mobileInstallHintTitle")}</p>
              <p className="mt-1 text-xs leading-5 text-alabaster-grey-500">{t("mobileInstallHintBody")}</p>
            </div>
          </div>
        </div>
      ) : null}
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <motion.button
            key={action.route}
            className="flex min-h-24 items-center gap-4 rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-4 text-left text-white shadow-[0_16px_40px_rgba(0,0,0,0.18)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-powder-blue-500/70"
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => onRouteChange(action.route)}
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-powder-blue-500/30 bg-powder-blue-950 text-powder-blue-500">
              <Icon aria-hidden="true" className="h-6 w-6" strokeWidth={1.5} />
            </span>
            <span className="text-base font-semibold leading-tight">{t(action.labelKey)}</span>
          </motion.button>
        );
      })}
    </section>
  );
}

function shouldShowInstallHint() {
  const tauriRuntime = "__TAURI__" in window;
  const iosStandalone = Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || iosStandalone;
  return !tauriRuntime && !standalone;
}
