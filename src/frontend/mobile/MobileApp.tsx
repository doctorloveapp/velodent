import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check, FileText, History, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { L10nKey } from "@/frontend/shared/i18n/L10nProvider";
import { useL10n } from "@/frontend/shared/i18n/L10nProvider";
import type { User } from "@/frontend/settings/settingsApi";
import { Button } from "@/frontend/shared/ui/button";
import type { Patient } from "@/frontend/patients/patientsApi";
import { deleteClinicalRecord, listClinicalRecords, markClinicalRecordPerformed, type ClinicalRecord } from "@/frontend/clinical/clinicalApi";
import {
  listPatientConsents,
  patientConsentDocumentDataUrl,
  type PatientConsent
} from "@/frontend/consents/consentsApi";
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
  const [clinicalHistoryOpen, setClinicalHistoryOpen] = useState(false);
  const [clinicalRefreshKey, setClinicalRefreshKey] = useState(0);
  const [activePatient, setActivePatient] = useState<Patient | null>(null);
  const [activeRoute, setActiveRoute] = useState<MobileRouteKey>("dashboard");
  const [selectedToothRecordInfo, setSelectedToothRecordInfo] = useState<SelectedToothRecordInfo | null>(null);
  const activeContent = routeContent[activeRoute];
  const title = t(activeContent.titleKey);
  const activePatientName = activePatient ? `${activePatient.first_name} ${activePatient.last_name}` : undefined;
  const handleMissingPatient = useCallback(() => setActiveRoute("searchPatient"), []);

  function changeRoute(route: MobileRouteKey) {
    setClinicalDiaryOpen(false);
    setClinicalHistoryOpen(false);
    setClinicalAssetMode(null);
    setSelectedToothRecordInfo(null);
    setActiveRoute(route);
  }

  async function handleSelectedToothClear() {
    if (!selectedToothRecordInfo || !currentUser.session_token) {
      return;
    }
    await deleteClinicalRecord(currentUser.session_token, selectedToothRecordInfo.recordId);
    setSelectedToothRecordInfo(null);
    setClinicalRefreshKey((current) => current + 1);
  }

  async function handleSelectedToothPerformed() {
    if (!selectedToothRecordInfo || selectedToothRecordInfo.status === "performed" || !currentUser.session_token) {
      return;
    }
    await markClinicalRecordPerformed(currentUser.session_token, selectedToothRecordInfo.recordId);
    setSelectedToothRecordInfo({
      ...selectedToothRecordInfo,
      status: "performed"
    });
    setClinicalRefreshKey((current) => current + 1);
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
            {activeRoute === "clinical" ? (
              <Button
                aria-label={t("clinicalHistory")}
                className="h-11 w-11 justify-center p-0"
                type="button"
                variant="secondary"
                onClick={() => setClinicalHistoryOpen(true)}
              >
                <History aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
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
            <div className="grid gap-3 rounded-xl border border-powder-blue-500/25 bg-powder-blue-950/70 p-3 text-sm text-white">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">
                  {t("mobileRecordedTooth")}
                </p>
                <p className="mt-1 truncate font-semibold">
                  {String(selectedToothRecordInfo.toothNumber)} - {selectedToothRecordInfo.serviceName}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="h-11 justify-center border-red-500/45 text-red-300 hover:bg-red-500/15 hover:text-red-100"
                  onClick={() => void handleSelectedToothClear().catch(() => undefined)}
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
                  {t("mobileClearTooth")}
                </Button>
                <Button
                  type="button"
                  className="h-11 justify-center border-gray-400/45 bg-gray-600 text-white hover:bg-gray-500"
                  disabled={selectedToothRecordInfo.status === "performed"}
                  onClick={() => void handleSelectedToothPerformed().catch(() => undefined)}
                >
                  <Check aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
                  {t("clinicalMarkPerformed")}
                </Button>
              </div>
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
                refreshKey={clinicalRefreshKey}
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
                refreshKey={clinicalRefreshKey}
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
                refreshKey={clinicalRefreshKey}
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
      {activeRoute === "clinical" && activePatient ? (
        <MobileClinicalHistoryDrawer
          open={clinicalHistoryOpen}
          patient={activePatient}
          sessionToken={currentUser.session_token ?? ""}
          onClose={() => setClinicalHistoryOpen(false)}
        />
      ) : null}
    </MobileShell>
  );
}

function MobileClinicalHistoryDrawer({
  onClose,
  open,
  patient,
  sessionToken
}: {
  onClose: () => void;
  open: boolean;
  patient: Patient;
  sessionToken: string;
}) {
  const { t } = useL10n();
  const [records, setRecords] = useState<ClinicalRecord[]>([]);
  const [consents, setConsents] = useState<PatientConsent[]>([]);
  const [viewer, setViewer] = useState<{ title: string; dataUrl: string } | null>(null);

  useEffect(() => {
    if (!open || !sessionToken) {
      return;
    }
    let cancelled = false;
    async function loadHistory() {
      const [nextRecords, nextConsents] = await Promise.all([
        listClinicalRecords(sessionToken, patient.id, {}),
        listPatientConsents(sessionToken, patient.id)
      ]);
      if (cancelled) {
        return;
      }
      setRecords(nextRecords.filter((record) => record.status === "performed"));
      setConsents(nextConsents.filter((consent) => Boolean(consent.file_asset_id)));
    }
    void loadHistory().catch(() => {
      if (!cancelled) {
        setRecords([]);
        setConsents([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, patient.id, sessionToken]);

  async function openConsent(consent: PatientConsent) {
    const document = await patientConsentDocumentDataUrl(sessionToken, consent.id);
    setViewer({ title: consent.template_title, dataUrl: document.data_url });
  }

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/45 px-3 pb-3 backdrop-blur-sm">
      <section
        className="grid max-h-[82dvh] w-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-t-2xl border border-alabaster-grey-500/20 bg-glaucous-950 shadow-[0_-24px_80px_rgba(0,0,0,0.45)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center justify-between border-b border-alabaster-grey-500/20 p-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">{t("clinicalHistory")}</p>
            <h2 className="text-base font-semibold text-white">{patient.first_name} {patient.last_name}</h2>
          </div>
          <Button aria-label={t("mobileCloseMenu")} className="h-11 w-11 justify-center p-0" type="button" variant="secondary" onClick={onClose}>
            <X aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
          </Button>
        </div>
        <div className="grid min-h-0 gap-4 overflow-y-auto p-4">
          <div>
            <h3 className="text-sm font-semibold text-white">{t("clinicalHistoryPerformedTitle")}</h3>
            <div className="mt-2 grid gap-2">
              {records.length ? records.map((record) => (
                <article key={record.id} className="rounded-xl border border-gray-500/25 bg-gray-600/15 p-3">
                  <p className="text-sm font-semibold text-white">{record.service_name ?? record.pathology_description ?? t("clinicalNoService")}</p>
                  <p className="mt-1 font-mono text-[11px] text-alabaster-grey-500">{record.created_at.slice(0, 10)} - {record.tooth_number ?? t("clinicalArch")}</p>
                </article>
              )) : (
                <p className="rounded-xl border border-alabaster-grey-500/20 bg-ink-black-950 p-3 text-sm text-alabaster-grey-500">{t("clinicalHistoryEmpty")}</p>
              )}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">{t("clinicalHistoryDocumentsTitle")}</h3>
            <div className="mt-2 grid gap-2">
              {consents.length ? consents.map((consent) => (
                <Button key={consent.id} type="button" variant="secondary" className="h-auto min-h-12 justify-start py-2 text-left" onClick={() => void openConsent(consent).catch(() => undefined)}>
                  <FileText aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
                  <span className="min-w-0 truncate">{consent.template_title}</span>
                </Button>
              )) : (
                <p className="rounded-xl border border-alabaster-grey-500/20 bg-ink-black-950 p-3 text-sm text-alabaster-grey-500">{t("clinicalHistoryDocumentsEmpty")}</p>
              )}
            </div>
          </div>
        </div>
      </section>
      {viewer ? (
        <div className="fixed inset-0 z-[60] grid bg-ink-black-950/95 p-3">
          <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950">
            <div className="flex items-center justify-between gap-2 border-b border-alabaster-grey-500/20 p-3">
              <h3 className="min-w-0 truncate text-sm font-semibold text-white">{viewer.title}</h3>
              <Button aria-label={t("mobileCloseMenu")} className="h-10 w-10 justify-center p-0" type="button" variant="secondary" onClick={() => setViewer(null)}>
                <X aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
              </Button>
            </div>
            <iframe className="h-full w-full bg-white" title={viewer.title} src={viewer.dataUrl} />
          </div>
        </div>
      ) : null}
    </div>
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
