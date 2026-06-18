import { Activity, CalendarDays, CircleDollarSign, ClipboardList, Images, Search, Settings, UserRound, UsersRound, Wifi } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { getHealthStatus, type HealthStatus } from "@/frontend/shared/api/health";
import { Badge } from "@/frontend/shared/ui/badge";
import { Button } from "@/frontend/shared/ui/button";
import { Input } from "@/frontend/shared/ui/input";
import { useL10n } from "@/frontend/shared/i18n/L10nProvider";
import { SettingsPanel } from "@/frontend/settings/SettingsPanel";
import type { User } from "@/frontend/settings/settingsApi";
import { CommandPalette } from "./CommandPalette";
import type { Patient } from "@/frontend/patients/patientsApi";

const navItems = [
  { key: "agenda", icon: CalendarDays, labelKey: "navAgenda" },
  { key: "patients", icon: UsersRound, labelKey: "navPatients" },
  { key: "clinical", icon: ClipboardList, labelKey: "navClinical" },
  { key: "rx", icon: Images, labelKey: "navRx" },
  { key: "billing", icon: CircleDollarSign, labelKey: "navBilling" },
  { key: "settings", icon: Settings, labelKey: "navSettings" }
] as const;

const LAST_SECTION_STORAGE_KEY = "velodent:last-section";

export function AppShell() {
  const { t } = useL10n();
  const [activeKey, setActiveKey] = useState<(typeof navItems)[number]["key"]>(() => {
    const stored = window.localStorage.getItem(LAST_SECTION_STORAGE_KEY);
    return navItems.some((item) => item.key === stored) ? (stored as (typeof navItems)[number]["key"]) : "agenda";
  });
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [health, setHealth] = useState<HealthStatus>({
    status: "checking",
    message: t("healthChecking")
  });

  useEffect(() => {
    let mounted = true;

    void getHealthStatus(t).then((status) => {
      if (mounted) {
        setHealth(status);
      }
    });

    return () => {
      mounted = false;
    };
  }, [t]);

  useEffect(() => {
    window.localStorage.setItem(LAST_SECTION_STORAGE_KEY, activeKey);
  }, [activeKey]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="flex min-h-screen bg-ink-black-950 text-ink-black-50">
      <aside className="fixed inset-y-0 left-0 z-20 flex w-[260px] flex-col border-r border-white/5 bg-ink-black-950">
        <div className="flex h-[60px] items-center gap-3 border-b border-white/5 px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-powder-blue-500/35 bg-powder-blue-950 text-powder-blue-500 shadow-[0_0_22px_rgba(47,127,208,0.24)]">
            <Activity aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-sm font-semibold leading-none text-white">{t("brandName")}</p>
            <p className="mt-1 text-[10px] font-medium uppercase tracking-widest text-alabaster-grey-500">
              {t("brandStandard")}
            </p>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeKey === item.key;

            return (
              <motion.div
                key={item.key}
                animate={{ opacity: 1, y: 0 }}
                initial={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.24, delay: 0.05 }}
              >
                <Button
                  type="button"
                  variant={active ? "navActive" : "nav"}
                  className="w-full justify-start"
                  onClick={() => setActiveKey(item.key)}
                >
                  <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
                  <span>{t(item.labelKey)}</span>
                </Button>
              </motion.div>
            );
          })}
        </nav>

        <div className="border-t border-white/5 p-4">
          <div className="rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-alabaster-grey-500">
              {t("sidebarClinicStationLabel")}
            </p>
            <p className="mt-2 text-sm font-medium text-white">{t("sidebarClinicStationValue")}</p>
          </div>
        </div>
      </aside>

      <div className="ml-[260px] flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-[60px] items-center gap-4 border-b border-alabaster-grey-500/20 bg-ink-black-950/95 px-5 backdrop-blur">
          <div className="relative max-w-xl flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-alabaster-grey-500" strokeWidth={1.5} />
            <Input
              aria-label={t("searchAriaLabel")}
              className="h-10 cursor-pointer pl-10"
              placeholder={t("searchPlaceholder")}
              readOnly
              type="search"
              onFocus={() => setCommandPaletteOpen(true)}
              onClick={() => setCommandPaletteOpen(true)}
            />
            <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-alabaster-grey-500/20 px-2 py-1 font-mono text-[10px] text-alabaster-grey-500">
              {t("searchShortcut")}
            </kbd>
          </div>

          <Badge variant="default" className="font-mono">
            <Wifi aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.5} />
            {t("syncReady")}
          </Badge>

          <Badge
            variant={health.status === "ready" ? "success" : "warning"}
            className="font-mono"
          >
            <span className="h-2 w-2 rounded-full bg-current shadow-[0_0_12px_currentColor]" />
            {health.message}
          </Badge>

          <Badge variant={currentUser ? "success" : "warning"}>
            <UserRound aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.5} />
            {currentUser ? currentUser.username : t("topBarNoUser")}
          </Badge>
        </header>

        <main className="flex-1 overflow-y-auto bg-ink-black-950 p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeKey}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              initial={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.3 }}
            >
              {activeKey === "settings" ? (
                <SettingsPanel currentUser={currentUser} onCurrentUserChange={setCurrentUser} />
              ) : (
                <DashboardWorkspace selectedPatient={selectedPatient} />
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onPatientSelected={(patient) => {
          setSelectedPatient(patient);
          setActiveKey("patients");
        }}
      />
    </div>
  );
}

function DashboardWorkspace({ selectedPatient }: { selectedPatient: Patient | null }) {
  const { t } = useL10n();

  return (
    <section className="grid gap-4">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">
          {t("workspaceEyebrow")}
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-white">{t("workspaceTitle")}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-alabaster-grey-500">
          {t("workspaceSubtitle")}
        </p>
      </div>

      {selectedPatient ? (
        <div className="rounded-xl border border-powder-blue-500/25 bg-powder-blue-950 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">
            {t("selectedPatientEyebrow")}
          </p>
          <p className="mt-2 text-lg font-semibold text-white">
            {selectedPatient.last_name} {selectedPatient.first_name}
          </p>
          <p className="mt-1 font-mono text-xs text-alabaster-grey-500">{selectedPatient.tax_code}</p>
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-alabaster-grey-500">
            {t("metricAgendaLabel")}
          </p>
          <p className="mt-3 text-2xl font-semibold text-white">{t("metricAgendaValue")}</p>
        </div>
        <div className="rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-alabaster-grey-500">
            {t("metricSyncLabel")}
          </p>
          <p className="mt-3 text-2xl font-semibold text-white">{t("metricSyncValue")}</p>
        </div>
        <div className="rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-alabaster-grey-500">
            {t("metricClinicalLabel")}
          </p>
          <p className="mt-3 text-2xl font-semibold text-white">{t("metricClinicalValue")}</p>
        </div>
      </div>
    </section>
  );
}
