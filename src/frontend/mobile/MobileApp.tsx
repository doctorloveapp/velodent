import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, FileText } from "lucide-react";
import { useCallback, useState } from "react";
import type { L10nKey } from "@/frontend/shared/i18n/L10nProvider";
import { useL10n } from "@/frontend/shared/i18n/L10nProvider";
import type { User } from "@/frontend/settings/settingsApi";
import { Button } from "@/frontend/shared/ui/button";
import type { Patient } from "@/frontend/patients/patientsApi";
import { MobileShell, type MobileRouteKey } from "./MobileShell";
import { MobileAgenda } from "./MobileAgenda";
import { MobileClinical, type SelectedToothRecordInfo } from "./MobileClinical";
import { MobileConsents } from "./MobileConsents";
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
  rx: {
    titleKey: "mobileRxPhotoTitle",
    bodyKey: "mobileRxPhotoBody"
  },
  orthodontics: {
    titleKey: "mobileOrthodonticsTitle",
    bodyKey: "mobileOrthodonticsBody"
  },
  consents: {
    titleKey: "mobileConsentsTitle",
    bodyKey: "mobileConsentsBody"
  }
};

export function MobileApp({ currentUser, onLogout }: MobileAppProps) {
  const { t } = useL10n();
  const [clinicalAssetMode, setClinicalAssetMode] = useState<"rx" | "photo" | null>(null);
  const [clinicalDiaryCount, setClinicalDiaryCount] = useState(0);
  const [clinicalDiaryOpen, setClinicalDiaryOpen] = useState(false);
  const [activePatient, setActivePatient] = useState<Patient | null>(null);
  const [activeRoute, setActiveRoute] = useState<MobileRouteKey>("dashboard");
  const [selectedToothRecordInfo, setSelectedToothRecordInfo] = useState<SelectedToothRecordInfo | null>(null);
  const activeContent = routeContent[activeRoute];
  const title = t(activeContent.titleKey);
  const activePatientName = activePatient ? `${activePatient.first_name} ${activePatient.last_name}` : undefined;
  const handleMissingPatient = useCallback(() => setActiveRoute("searchPatient"), []);

  function changeRoute(route: MobileRouteKey) {
    setClinicalDiaryOpen(false);
    setClinicalAssetMode(null);
    setSelectedToothRecordInfo(null);
    setActiveRoute(route);
  }

  return (
    <MobileShell
      activeRoute={activeRoute}
      currentUser={currentUser}
      headerActions={
        (activeRoute === "clinical" || activeRoute === "orthodontics") && activePatient ? (
          <div className="flex items-center gap-2">
            {activeRoute === "clinical" && clinicalAssetMode ? (
              <Button
                aria-label={t("mobileBackToOdontogram")}
                className="h-11 w-11 justify-center p-0"
                type="button"
                variant="secondary"
                onClick={() => setClinicalAssetMode(null)}
              >
                <ArrowLeft aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
              </Button>
            ) : null}
            <Button
              aria-label={t("mobileOpenClinicalDiary")}
              className="relative h-11 w-11 justify-center p-0"
              type="button"
              variant="secondary"
              onClick={() => setClinicalDiaryOpen(true)}
            >
              <FileText aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
              <span className="absolute -bottom-1 -right-1 grid min-h-5 min-w-5 place-items-center rounded-full border border-ink-black-950 bg-powder-blue-500 px-1 font-mono text-[10px] font-bold leading-none text-white">
                {clinicalDiaryCount}
              </span>
            </Button>
          </div>
        ) : undefined
      }
      headerAccessory={
        activeRoute === "clinical" ? (
          selectedToothRecordInfo ? (
            <div className="rounded-xl border border-powder-blue-500/25 bg-powder-blue-950/70 p-3 text-sm text-white">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">
                {t("mobileRecordedTooth")}
              </p>
              <p className="mt-1 truncate font-semibold">
                {String(selectedToothRecordInfo.toothNumber)} - {selectedToothRecordInfo.serviceName}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-2">
              {(["rx", "photo"] as const).map((item) => (
                <Button
                  key={item}
                  type="button"
                  variant={clinicalAssetMode === item ? "navActive" : "nav"}
                  className="h-11 justify-center"
                  onClick={() => setClinicalAssetMode((current) => (current === item ? null : item))}
                >
                  {item === "rx" ? t("clinicalAssetRx") : t("clinicalAssetPhoto")}
                </Button>
              ))}
            </div>
          )
        ) : undefined
      }
      patientName={(activeRoute === "clinical" || activeRoute === "rx" || activeRoute === "orthodontics" || activeRoute === "consents") ? activePatientName : undefined}
      title={title}
      onLogout={onLogout}
      onPatientNameClick={
        (activeRoute === "clinical" || activeRoute === "rx" || activeRoute === "orthodontics" || activeRoute === "consents") && activePatient ? () => {
          setClinicalAssetMode(null);
          setSelectedToothRecordInfo(null);
          setActivePatient(null);
        } : undefined
      }
      onRouteChange={changeRoute}
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
            <MobileDashboard onRouteChange={changeRoute} />
          ) : activeRoute === "agenda" ? (
            <MobileAgenda sessionToken={currentUser.session_token ?? ""} />
          ) : activeRoute === "newPatient" ? (
            <MobilePatientRegistration sessionToken={currentUser.session_token ?? ""} />
          ) : activeRoute === "searchPatient" ? (
            <MobilePatientSearch
              sessionToken={currentUser.session_token ?? ""}
              onPatientSelect={(patient) => {
                setActivePatient(patient);
                setActiveRoute("clinical");
              }}
            />
          ) : activeRoute === "rx" ? (
            activePatient ? (
              <MobileClinical
                activePatientId={activePatient.id}
                assetMode="rx"
                diaryOpen={false}
                mode="clinical"
                onMissingPatient={handleMissingPatient}
                onDiaryOpenChange={() => undefined}
                onClinicalDiaryCountChange={setClinicalDiaryCount}
                onSelectedToothRecordInfo={setSelectedToothRecordInfo}
                sessionToken={currentUser.session_token ?? ""}
              />
            ) : (
              <MobilePatientSearch
                sessionToken={currentUser.session_token ?? ""}
                onPatientSelect={(patient) => {
                  setActivePatient(patient);
                  setActiveRoute("rx");
                }}
              />
            )
          ) : activeRoute === "orthodontics" ? (
            activePatient ? (
              <MobileClinical
                activePatientId={activePatient.id}
                diaryOpen={clinicalDiaryOpen}
                mode="orthodontics"
                onMissingPatient={handleMissingPatient}
                onDiaryOpenChange={setClinicalDiaryOpen}
                onClinicalDiaryCountChange={setClinicalDiaryCount}
                onSelectedToothRecordInfo={setSelectedToothRecordInfo}
                sessionToken={currentUser.session_token ?? ""}
              />
            ) : (
              <MobilePatientSearch
                sessionToken={currentUser.session_token ?? ""}
                onPatientSelect={(patient) => {
                  setActivePatient(patient);
                  setActiveRoute("orthodontics");
                }}
              />
            )
          ) : activeRoute === "clinical" ? (
            activePatient ? (
              <MobileClinical
                activePatientId={activePatient.id}
                assetMode={clinicalAssetMode}
                diaryOpen={clinicalDiaryOpen}
                mode="clinical"
                onMissingPatient={handleMissingPatient}
                onDiaryOpenChange={setClinicalDiaryOpen}
                onClinicalDiaryCountChange={setClinicalDiaryCount}
                onSelectedToothRecordInfo={setSelectedToothRecordInfo}
                sessionToken={currentUser.session_token ?? ""}
              />
            ) : (
              <MobilePatientSearch
                sessionToken={currentUser.session_token ?? ""}
                onPatientSelect={(patient) => {
                  setActivePatient(patient);
                  setActiveRoute("clinical");
                }}
              />
            )
          ) : activeRoute === "consents" ? (
            activePatient ? (
              <MobileConsents patient={activePatient} sessionToken={currentUser.session_token ?? ""} />
            ) : (
              <MobilePatientSearch
                sessionToken={currentUser.session_token ?? ""}
                onPatientSelect={(patient) => {
                  setActivePatient(patient);
                  setActiveRoute("consents");
                }}
              />
            )
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
