import { CalendarDays, ChevronLeft, ChevronRight, Search, Stethoscope } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { listAppointments, type Appointment } from "@/frontend/agenda/agendaApi";
import { ClinicalPanel } from "@/frontend/clinical/ClinicalPanel";
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

  const range = useMemo(() => ({
    from: `${date}T00:00:00${localOffset(date, "00:00")}`,
    to: `${shiftDate(date, 1)}T00:00:00${localOffset(shiftDate(date, 1), "00:00")}`
  }), [date]);

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
    <section className="grid gap-4">
      <div className="rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-4">
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
          {statusMessage ? <span className="text-sm text-alabaster-grey-500">{statusMessage}</span> : null}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="grid content-start gap-4">
          <section className="rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">{t("clinicalAgendaToday")}</p>
                <h2 className="text-base font-semibold text-white">{String(appointments.length)}</h2>
              </div>
              <CalendarDays aria-hidden="true" className="h-5 w-5 text-powder-blue-500" strokeWidth={1.5} />
            </div>
            <div className="mb-3 flex items-center gap-2">
              <Button type="button" variant="secondary" size="icon" aria-label={t("agendaPrevious")} onClick={() => setDate(shiftDate(date, -1))}>
                <ChevronLeft aria-hidden="true" className="h-4 w-4" />
              </Button>
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              <Button type="button" variant="secondary" size="icon" aria-label={t("agendaNext")} onClick={() => setDate(shiftDate(date, 1))}>
                <ChevronRight aria-hidden="true" className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid max-h-[360px] gap-2 overflow-y-auto">
              {appointments.length ? appointments.map((appointment) => (
                <button
                  key={appointment.id}
                  className="rounded-md border border-alabaster-grey-500/20 bg-ink-black-950 p-3 text-left transition hover:border-powder-blue-500/55"
                  disabled={!appointment.patient_id}
                  type="button"
                  onClick={() => appointment.patient_id ? void openPatient(appointment.patient_id).catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("patientsGenericError"))) : undefined}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-white">{appointment.patient_name ?? t("agendaNoPatient")}</span>
                    <Badge variant="default">{appointment.starts_at.slice(11, 16)}</Badge>
                  </div>
                  <p className="mt-1 truncate text-xs text-alabaster-grey-500">{appointment.title}</p>
                </button>
              )) : (
                <p className="rounded-md border border-alabaster-grey-500/20 bg-ink-black-950 p-3 text-sm text-alabaster-grey-500">{t("agendaAppointmentsEmpty")}</p>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-4">
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-alabaster-grey-500" />
              <Input
                className="pl-9"
                placeholder={t("clinicalPatientSearch")}
                type="search"
                value={query}
                onChange={(event) => void handlePatientSearch(event.target.value).catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("patientsGenericError")))}
              />
            </div>
            <div className="mt-3 grid max-h-[320px] gap-2 overflow-y-auto">
              {patients.map((patient) => (
                <button
                  key={patient.id}
                  className="rounded-md border border-alabaster-grey-500/20 bg-ink-black-950 p-3 text-left transition hover:border-powder-blue-500/55"
                  type="button"
                  onClick={() => void openPatient(patient.id).catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("patientsGenericError")))}
                >
                  <span className="block text-sm font-semibold text-white">{patient.last_name} {patient.first_name}</span>
                  <span className="mt-1 block font-mono text-[11px] text-alabaster-grey-500">{patient.tax_code}</span>
                </button>
              ))}
            </div>
          </section>
        </div>

        <section className="rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-4">
          {selectedPatient ? (
            <ClinicalPanel currentUser={currentUser} patient={selectedPatient} />
          ) : (
            <p className="text-sm text-alabaster-grey-500">{t("patientsRecordEmpty")}</p>
          )}
        </section>
      </div>
    </section>
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
