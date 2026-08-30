import { CalendarDays, ChevronLeft, ChevronRight, FileText, History, Search, Stethoscope, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { listAppointments, type Appointment } from "@/frontend/agenda/agendaApi";
import { listClinicalRecords, type ClinicalRecord } from "@/frontend/clinical/clinicalApi";
import { ClinicalPanel } from "@/frontend/clinical/ClinicalPanel";
import {
  listPatientConsents,
  openPatientConsentDocument,
  type PatientConsent
} from "@/frontend/consents/consentsApi";
import { openPatientRecord, searchPatients, type Patient } from "@/frontend/patients/patientsApi";
import { useL10n } from "@/frontend/shared/i18n/L10nProvider";
import { Badge } from "@/frontend/shared/ui/badge";
import { Button } from "@/frontend/shared/ui/button";
import { Input } from "@/frontend/shared/ui/input";
import type { User } from "@/frontend/settings/settingsApi";

interface ClinicalWorkspaceProps {
  currentUser: User;
  selectedPatient: Patient | null;
  onPatientSelected: (patient: Patient | null) => void;
}

export function ClinicalWorkspace({ currentUser, onPatientSelected, selectedPatient }: ClinicalWorkspaceProps) {
  const { t } = useL10n();
  const [date, setDate] = useState(todayDateInput());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const range = useMemo(() => ({
    from: `${date}T00:00:00${localOffset(date, "00:00")}`,
    to: `${shiftDate(date, 1)}T00:00:00${localOffset(shiftDate(date, 1), "00:00")}`
  }), [date]);
  const dayPatients = useMemo(() => {
    const byPatient = new Map<number, Appointment>();
    appointments.forEach((appointment) => {
      if (appointment.patient_id && !byPatient.has(appointment.patient_id)) {
        byPatient.set(appointment.patient_id, appointment);
      }
    });
    return Array.from(byPatient.values()).sort((left, right) =>
      (left.patient_name ?? "").localeCompare(right.patient_name ?? "", "it", { sensitivity: "base" })
    );
  }, [appointments]);

  async function refreshAppointments() {
    setAppointments(await listAppointments(currentUser.session_token ?? "", range.from, range.to));
  }

  async function handlePatientSearch(nextQuery: string) {
    setQuery(nextQuery);
    setPatients(await searchPatients(currentUser.session_token ?? "", nextQuery, 12));
  }

  async function openPatient(patientId: number) {
    const opened = await openPatientRecord(currentUser.session_token ?? "", patientId);
    onPatientSelected(opened);
    setStatusMessage(t("clinicalWorkspacePatientOpened"));
  }

  useEffect(() => {
    void refreshAppointments().catch((error: unknown) => {
      setStatusMessage(error instanceof Error ? error.message : t("agendaGenericError"));
    });
  }, [range.from, range.to, currentUser.session_token]);

  useEffect(() => {
    void handlePatientSearch("").catch(() => undefined);
  }, [currentUser.session_token]);

  return (
    <section className="grid min-w-0 gap-3">
      <div className="rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md border border-powder-blue-500/30 bg-powder-blue-950 text-powder-blue-500">
              <Stethoscope aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">{t("clinicalWorkspaceEyebrow")}</p>
              <h1 className="text-lg font-semibold text-white">{t("clinicalWorkspaceTitle")}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {selectedPatient ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => setHistoryOpen(true)}>
                <History aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
                {t("clinicalHistory")}
              </Button>
            ) : null}
            {statusMessage ? <span className="text-sm text-alabaster-grey-500">{statusMessage}</span> : null}
          </div>
        </div>
      </div>

      <div className="grid min-w-0 items-stretch gap-3 xl:grid-cols-[190px_minmax(0,1fr)] 2xl:grid-cols-[210px_minmax(0,1fr)]">
        <div className="grid min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-2.5">
          <section className="min-w-0 rounded-lg border border-alabaster-grey-500/20 bg-glaucous-950 p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">{t("clinicalAgendaToday")}</p>
                <h2 className="text-sm font-semibold text-white">{String(dayPatients.length)}</h2>
              </div>
              <CalendarDays aria-hidden="true" className="h-4 w-4 text-powder-blue-500" strokeWidth={1.5} />
            </div>
            <div className="mb-2 flex min-w-0 items-center gap-1.5">
              <Button type="button" variant="secondary" size="icon" className="h-8 w-8 shrink-0" aria-label={t("agendaPrevious")} onClick={() => setDate(shiftDate(date, -1))}>
                <ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" />
              </Button>
              <Input className="h-8 min-w-0 text-xs" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              <Button type="button" variant="secondary" size="icon" className="h-8 w-8 shrink-0" aria-label={t("agendaNext")} onClick={() => setDate(shiftDate(date, 1))}>
                <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="grid max-h-[150px] gap-1.5 overflow-y-auto">
              {dayPatients.length ? dayPatients.map((appointment) => {
                const selected = selectedPatient?.id === appointment.patient_id;
                return (
                  <button
                    key={appointment.id}
                    className={[
                      "min-w-0 rounded-md border p-1.5 text-left transition",
                      selected
                        ? "border-amber-400/70 bg-amber-400/15 shadow-[0_0_24px_rgba(251,191,36,0.16)]"
                        : "border-alabaster-grey-500/20 bg-ink-black-950 hover:border-powder-blue-500/55"
                    ].join(" ")}
                    disabled={!appointment.patient_id}
                    type="button"
                    onClick={() => appointment.patient_id ? void openPatient(appointment.patient_id).catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("patientsGenericError"))) : undefined}
                  >
                    <div className="flex min-w-0 items-center justify-between gap-1.5">
                      <span className="min-w-0 truncate text-xs font-semibold text-white">{appointment.patient_name ?? t("agendaNoPatient")}</span>
                      <Badge className="shrink-0 px-1.5 text-[10px]" variant={selected ? "warning" : "default"}>{appointment.starts_at.slice(11, 16)}</Badge>
                    </div>
                    <p className="mt-0.5 truncate text-[10px] text-alabaster-grey-500">{appointment.title}</p>
                  </button>
                );
              }) : (
                <p className="rounded-md border border-alabaster-grey-500/20 bg-ink-black-950 p-1.5 text-[11px] text-alabaster-grey-500">{t("agendaAppointmentsEmpty")}</p>
              )}
            </div>
          </section>

          <section className="flex min-h-0 min-w-0 flex-col rounded-lg border border-alabaster-grey-500/20 bg-glaucous-950 p-2">
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-alabaster-grey-500" />
              <Input
                className="h-8 pl-8 text-xs"
                placeholder={t("clinicalPatientSearch")}
                type="search"
                value={query}
                onChange={(event) => void handlePatientSearch(event.target.value).catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("patientsGenericError")))}
              />
            </div>
            <div className="mt-2 grid min-h-0 flex-1 content-start gap-1.5 overflow-y-auto">
              {patients.map((patient) => {
                const selected = selectedPatient?.id === patient.id;
                return (
                  <button
                    key={patient.id}
                    className={[
                      "min-w-0 rounded-md border p-1.5 text-left transition",
                      selected
                        ? "border-amber-400/70 bg-amber-400/15 shadow-[0_0_24px_rgba(251,191,36,0.16)]"
                        : "border-alabaster-grey-500/20 bg-ink-black-950 hover:border-powder-blue-500/55"
                    ].join(" ")}
                    type="button"
                    onClick={() => void openPatient(patient.id).catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("patientsGenericError")))}
                  >
                    <span className="block truncate text-xs font-semibold text-white">{patient.last_name} {patient.first_name}</span>
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-alabaster-grey-500">{patient.tax_code}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        <section className="min-w-0 rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-2.5">
          {selectedPatient ? (
            <ClinicalPanel currentUser={currentUser} patient={selectedPatient} />
          ) : (
            <p className="text-sm text-alabaster-grey-500">{t("patientsRecordEmpty")}</p>
          )}
        </section>
      </div>
      {selectedPatient ? (
        <ClinicalHistorySidebar
          currentUser={currentUser}
          open={historyOpen}
          patient={selectedPatient}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}
    </section>
  );
}

function ClinicalHistorySidebar({
  currentUser,
  onClose,
  open,
  patient
}: {
  currentUser: User;
  onClose: () => void;
  open: boolean;
  patient: Patient;
}) {
  const { t } = useL10n();
  const [records, setRecords] = useState<ClinicalRecord[]>([]);
  const [consents, setConsents] = useState<PatientConsent[]>([]);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    if (!open || !currentUser.session_token) {
      return;
    }
    let cancelled = false;
    async function loadHistory() {
      const [nextRecords, nextConsents] = await Promise.all([
        listClinicalRecords(currentUser.session_token ?? "", patient.id, {}),
        listPatientConsents(currentUser.session_token ?? "", patient.id)
      ]);
      if (cancelled) {
        return;
      }
      setRecords(nextRecords.filter((record) => record.status === "performed"));
      setConsents(nextConsents.filter((consent) => Boolean(consent.file_asset_id)));
    }
    void loadHistory().catch((error: unknown) => {
      if (!cancelled) {
        setStatusMessage(error instanceof Error ? error.message : t("clinicalGenericError"));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currentUser.session_token, open, patient.id, t]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/35 backdrop-blur-sm" onClick={onClose}>
      <aside
        className="absolute right-0 top-0 grid h-full w-full max-w-[380px] grid-rows-[auto_minmax(0,1fr)] border-l border-alabaster-grey-500/20 bg-glaucous-950 shadow-[-24px_0_80px_rgba(0,0,0,0.45)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-alabaster-grey-500/20 p-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">{t("clinicalHistory")}</p>
            <h2 className="truncate text-base font-semibold text-white">{patient.first_name} {patient.last_name}</h2>
          </div>
          <Button aria-label={t("mobileCloseMenu")} className="h-9 w-9 justify-center p-0" type="button" variant="secondary" onClick={onClose}>
            <X aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
          </Button>
        </div>
        <div className="grid min-h-0 content-start gap-4 overflow-y-auto p-4">
          {statusMessage ? <p className="text-xs text-alabaster-grey-500">{statusMessage}</p> : null}
          <section>
            <h3 className="text-sm font-semibold text-white">{t("clinicalHistoryPerformedTitle")}</h3>
            <div className="mt-2 grid gap-2">
              {records.length ? records.map((record) => (
                <article key={record.id} className="rounded-md border border-gray-500/25 bg-gray-600/15 p-3">
                  <p className="truncate text-sm font-semibold text-white">{record.service_name ?? record.pathology_description ?? t("clinicalNoService")}</p>
                  <p className="mt-1 font-mono text-[11px] text-alabaster-grey-500">{record.created_at.slice(0, 10)} - {record.tooth_number ?? t("clinicalArch")}</p>
                </article>
              )) : (
                <p className="rounded-md border border-alabaster-grey-500/20 bg-ink-black-950 p-3 text-sm text-alabaster-grey-500">{t("clinicalHistoryEmpty")}</p>
              )}
            </div>
          </section>
          <section>
            <h3 className="text-sm font-semibold text-white">{t("clinicalHistoryDocumentsTitle")}</h3>
            <div className="mt-2 grid gap-2">
              {consents.length ? consents.map((consent) => (
                <Button
                  key={consent.id}
                  type="button"
                  variant="secondary"
                  className="h-auto min-h-10 justify-start py-2 text-left text-xs"
                  onClick={() => void openPatientConsentDocument(currentUser.session_token ?? "", consent.id).catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("clinicalGenericError")))}
                >
                  <FileText aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
                  <span className="min-w-0 truncate">{consent.template_title}</span>
                </Button>
              )) : (
                <p className="rounded-md border border-alabaster-grey-500/20 bg-ink-black-950 p-3 text-sm text-alabaster-grey-500">{t("clinicalHistoryDocumentsEmpty")}</p>
              )}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}

function todayDateInput() {
  return toDateInput(new Date());
}

function shiftDate(dateInput: string, days: number) {
  const date = new Date(`${dateInput}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toDateInput(date);
}

function toDateInput(date: Date) {
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localOffset(dateInput: string, timeInput: string) {
  const offsetMinutes = -new Date(`${dateInput}T${timeInput}:00`).getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}
