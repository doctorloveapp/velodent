import {
  CalendarDays,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Smartphone,
  UserPlus,
  Wifi,
  X,
  type LucideIcon
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useState, type ReactNode } from "react";
import type { L10nKey } from "@/frontend/shared/i18n/L10nProvider";
import { useL10n } from "@/frontend/shared/i18n/L10nProvider";
import type { User } from "@/frontend/settings/settingsApi";
import { Badge } from "@/frontend/shared/ui/badge";
import { Button } from "@/frontend/shared/ui/button";

export type MobileRouteKey =
  | "dashboard"
  | "agenda"
  | "newPatient"
  | "searchPatient"
  | "clinical"
  | "consents"
  | "deviceStatus";

interface MobileNavItem {
  icon: LucideIcon;
  key: MobileRouteKey;
  labelKey: L10nKey;
}

const mobileNavItems: MobileNavItem[] = [
  { key: "dashboard", icon: LayoutDashboard, labelKey: "mobileDashboard" },
  { key: "agenda", icon: CalendarDays, labelKey: "mobileAgenda" },
  { key: "newPatient", icon: UserPlus, labelKey: "mobileNewPatient" },
  { key: "searchPatient", icon: Search, labelKey: "mobileSearchPatient" },
  { key: "clinical", icon: ClipboardList, labelKey: "mobileClinical" },
  { key: "consents", icon: FileText, labelKey: "mobileConsents" },
  { key: "deviceStatus", icon: Smartphone, labelKey: "mobileDeviceStatus" }
];

interface MobileShellProps {
  activeRoute: MobileRouteKey;
  children: ReactNode;
  currentUser: User;
  headerAccessory?: ReactNode;
  patientName?: string;
  title: string;
  onLogout: () => void;
  onRouteChange: (route: MobileRouteKey) => void;
}

export function MobileShell({
  activeRoute,
  children,
  currentUser,
  headerAccessory,
  patientName,
  title,
  onLogout,
  onRouteChange
}: MobileShellProps) {
  const { t } = useL10n();
  const [menuOpen, setMenuOpen] = useState(false);
  const headerTitle = patientName ?? title;

  function selectRoute(route: MobileRouteKey) {
    onRouteChange(route);
    setMenuOpen(false);
  }

  return (
    <div className="min-h-[100dvh] bg-ink-black-950 text-ink-black-50">
      <header
        className="sticky top-0 z-30 border-b border-alabaster-grey-500/20 bg-ink-black-950/95 backdrop-blur"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="flex min-h-16 items-center gap-3 px-4">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">
              {t("mobilePrecision")}
            </p>
            <h1 className="truncate text-lg font-semibold text-white">{headerTitle}</h1>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="default" className="h-9 gap-1 px-2 font-mono text-[10px]">
              <Wifi aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span className="hidden min-[380px]:inline">{t("mobileLanReady")}</span>
              <span className="min-[380px]:hidden">{t("mobileSyncReady")}</span>
            </Badge>
            <Button
              aria-label={t("mobileMenu")}
              className="h-12 w-12 justify-center p-0"
              type="button"
              variant="secondary"
              onClick={() => setMenuOpen(true)}
            >
              <Menu aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
            </Button>
          </div>
        </div>
        {headerAccessory ? <div className="px-4 pb-3">{headerAccessory}</div> : null}
      </header>

      <main className="px-4 py-4" style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}>
        {children}
      </main>

      <AnimatePresence>
        {menuOpen ? (
          <motion.div
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-40 bg-black/55 p-3 backdrop-blur-sm"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={() => setMenuOpen(false)}
          >
            <motion.aside
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="glass ml-auto grid max-h-[calc(100dvh-1.5rem)] w-full max-w-[420px] gap-4 overflow-y-auto rounded-xl border border-alabaster-grey-500/20 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
              exit={{ opacity: 0, scale: 0.98, y: -8 }}
              initial={{ opacity: 0, scale: 0.98, y: -8 }}
              style={{
                marginTop: "env(safe-area-inset-top)",
                paddingBottom: "calc(1rem + env(safe-area-inset-bottom))"
              }}
              transition={{ duration: 0.18 }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">
                    {currentUser.username}
                  </p>
                  <h2 className="text-lg font-semibold text-white">{t("mobileMenu")}</h2>
                </div>
                <Button
                  aria-label={t("mobileMenu")}
                  className="h-11 w-11 justify-center p-0"
                  type="button"
                  variant="secondary"
                  onClick={() => setMenuOpen(false)}
                >
                  <X aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
                </Button>
              </div>

              <nav className="grid gap-2">
                {mobileNavItems.map((item) => {
                  const Icon = item.icon;
                  const active = item.key === activeRoute;
                  return (
                    <Button
                      key={item.key}
                      type="button"
                      variant={active ? "navActive" : "nav"}
                      className="h-14 justify-start text-base"
                      onClick={() => selectRoute(item.key)}
                    >
                      <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
                      <span>{t(item.labelKey)}</span>
                    </Button>
                  );
                })}
              </nav>

              <div className="border-t border-alabaster-grey-500/15 pt-3">
                <Button
                  type="button"
                  variant="secondary"
                  className="h-14 w-full justify-start text-base"
                  onClick={() => {
                    setMenuOpen(false);
                    onLogout();
                  }}
                >
                  <LogOut aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
                  <span>{t("mobileLogout")}</span>
                </Button>
              </div>
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
