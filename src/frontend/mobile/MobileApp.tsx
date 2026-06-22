import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useState } from "react";
import type { L10nKey } from "@/frontend/shared/i18n/L10nProvider";
import { useL10n } from "@/frontend/shared/i18n/L10nProvider";
import type { User } from "@/frontend/settings/settingsApi";
import { Button } from "@/frontend/shared/ui/button";
import type { Patient } from "@/frontend/patients/patientsApi";
import { MobileShell, type MobileRouteKey } from "./MobileShell";
import { MobileAgenda } from "./MobileAgenda";
import { MobileClinical } from "./MobileClinical";
import { MobileDashboard } from "./MobileDashboard";
import { MobilePatientRegistration } from "./MobilePatientRegistration";
import { MobilePatientSearch } from "./MobilePatientSearch";

interface MobileAppProps {
  currentUser: User;
  onLogout: () => void;
}

interface RouteContent {
  titleKey: L10nKey;
  bodyKey: L10nKey;
}

const routeContent: Record<MobileRouteKey, RouteContent> = {
  dashboard: {
    titleKey: "mobileDashboardTitle",
    bodyKey: "mobileDashboardBody"
  },
  agenda: {
    titleKey: "mobileAgendaTitle",
    bodyKey: "mobileAgendaBody"
  },
  newPatient: {
    titleKey: "mobileNewPatientTitle",
    bodyKey: "mobileNewPatientBody"
  },
  searchPatient: {
    titleKey: "mobileSearchPatientTitle",
    bodyKey: "mobileSearchPatientBody"
  },
  clinical: {
    titleKey: "mobileClinicalTitle",
    bodyKey: "mobileClinicalBody"
  },
  consents: {
    titleKey: "mobileConsentsTitle",
    bodyKey: "mobileConsentsBody"
  },
  deviceStatus: {
    titleKey: "mobileDeviceStatusTitle",
    bodyKey: "mobileDeviceStatusBody"
  }
};

export function MobileApp({ currentUser, onLogout }: MobileAppProps) {
  const { t } = useL10n();
  const [clinicalMode, setClinicalMode] = useState<"clinical" | "orthodontics">("clinical");
  const [activePatient, setActivePatient] = useState<Patient | null>(null);
  const [activeRoute, setActiveRoute] = useState<MobileRouteKey>("dashboard");
  const activeContent = routeContent[activeRoute];
  const title = t(activeContent.titleKey);
  const activePatientName = activePatient ? `${activePatient.first_name} ${activePatient.last_name}` : undefined;
  const handleMissingPatient = useCallback(() => setActiveRoute("searchPatient"), []);

  return (
    <MobileShell
      activeRoute={activeRoute}
      currentUser={currentUser}
      headerAccessory={
        activeRoute === "clinical" ? (
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-2">
            {(["clinical", "orthodontics"] as const).map((item) => (
              <Button
                key={item}
                type="button"
                variant={clinicalMode === item ? "navActive" : "nav"}
                className="h-11 justify-center"
                onClick={() => setClinicalMode(item)}
              >
                {item === "clinical" ? t("mobileClinicalMode") : t("mobileOrthodonticsMode")}
              </Button>
            ))}
          </div>
        ) : undefined
      }
      patientName={activeRoute === "clinical" ? activePatientName : undefined}
      title={title}
      onLogout={onLogout}
      onRouteChange={setActiveRoute}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={activeRoute}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          initial={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.22 }}
        >
          {activeRoute === "dashboard" ? (
            <MobileDashboard onRouteChange={setActiveRoute} />
          ) : activeRoute === "agenda" ? (
            <MobileAgenda sessionToken={currentUser.session_token ?? ""} />
          ) : activeRoute === "newPatient" ? (
            <MobilePatientRegistration />
          ) : activeRoute === "searchPatient" ? (
            <MobilePatientSearch
              sessionToken={currentUser.session_token ?? ""}
              onPatientSelect={(patient) => {
                setActivePatient(patient);
                setActiveRoute("clinical");
              }}
            />
          ) : activeRoute === "clinical" ? (
            <MobileClinical
              activePatientId={activePatient?.id ?? null}
              mode={clinicalMode}
              onMissingPatient={handleMissingPatient}
              sessionToken={currentUser.session_token ?? ""}
            />
          ) : (
            <MobilePlaceholder
              body={t(activeContent.bodyKey)}
              eyebrow={t("brandName")}
              title={title}
              primaryLabel={t("mobilePrimaryAction")}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </MobileShell>
  );
}

function MobilePlaceholder({
  body,
  eyebrow,
  primaryLabel,
  title
}: {
  body: string;
  eyebrow: string;
  primaryLabel: string;
  title: string;
}) {
  return (
    <section className="grid min-h-[calc(100dvh-7.5rem)] content-between gap-6">
      <div className="grid gap-4">
        <div className="rounded-xl border border-powder-blue-500/20 bg-glaucous-950 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">
            {eyebrow}
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-white">{title}</h1>
          <p className="mt-3 text-sm leading-6 text-alabaster-grey-500">{body}</p>
        </div>
      </div>

      <div
        className="sticky bottom-0 -mx-4 border-t border-alabaster-grey-500/20 bg-ink-black-950/95 px-4 py-3 backdrop-blur"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <Button type="button" className="h-14 w-full justify-center text-base">
          {primaryLabel}
        </Button>
      </div>
    </section>
  );
}
