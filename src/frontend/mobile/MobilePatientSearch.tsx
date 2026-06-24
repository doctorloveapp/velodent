import { Search } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { listAppointments, type Appointment } from "@/frontend/agenda/agendaApi";
import { openPatientRecord, searchPatients, type Patient } from "@/frontend/patients/patientsApi";
import { useL10n } from "@/frontend/shared/i18n/L10nProvider";
import { Input } from "@/frontend/shared/ui/input";

interface MobilePatientSearchProps {
  sessionToken: string;
  onPatientSelect: (patient: Patient) => void;
}

export function MobilePatientSearch({ sessionToken, onPatientSelect }: MobilePatientSearchProps) {
  const { t } = useL10n();
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [statusMessage, setStatusMessage] = useState(t("mobileSearchPatientStart"));
  const [loadingPatientId, setLoadingPatientId] = useState<number | null>(null);
  const [todayAppointments, setTodayAppointments] = useState<Appointment[]>([]);

  useEffect(() => {
    if (!sessionToken) {
      return;
    }
    const today = todayDateInput();
    void listAppointments(
      sessionToken,
      `${today}T00:00:00${localOffset(today, "00:00")}`,
      `${shiftDate(today, 1)}T00:00:00${localOffset(shiftDate(today, 1), "00:00")}`
    )
      .then(setTodayAppointments)
      .catch(() => setTodayAppointments([]));
  }, [sessionToken]);

  useEffect(() => {
    if (!sessionToken) {
      return;
    }
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setPatients([]);
      setStatusMessage(t("mobileSearchPatientStart"));
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchPatients(sessionToken, trimmed, 20)
        .then((results) => {
          if (cancelled) {
            return;
          }
          setPatients(results);
          setStatusMessage(results.length ? "" : t("mobileSearchNoPatients"));
        })
        .catch(() => {
          if (!cancelled) {
            setPatients([]);
            setStatusMessage(t("mobileSearchError"));
          }
        });
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, sessionToken, t]);

  async function handleSelect(patient: Patient) {
    setLoadingPatientId(patient.id);
    try {
      const openedPatient = await openPatientRecord(sessionToken, patient.id);
      onPatientSelect(openedPatient);
    } catch {
      setStatusMessage(t("mobileSearchError"));
    } finally {
      setLoadingPatientId(null);
    }
  }

  return (
    <section className="grid gap-4">
      <QuickPatients
        appointments={todayAppointments}
        loadingPatientId={loadingPatientId}
        onSelect={(patientId) => void handleSelectById(patientId)}
      />
      <label className="relative block">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-powder-blue-500"
          strokeWidth={1.5}
        />
        <Input
          className="h-14 pl-12 text-base"
          placeholder={t("mobileSearchPatientInputPlaceholder")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      <div className="grid gap-2">
        {patients.map((patient) => (
          <motion.button
            key={patient.id}
            className="flex min-h-16 items-center rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 px-4 text-left text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-powder-blue-500/70 disabled:opacity-60"
            disabled={loadingPatientId !== null}
            type="button"
            whileTap={{ scale: 0.98 }}
            onClick={() => void handleSelect(patient)}
          >
            <span className="text-lg font-semibold leading-tight">
              {patient.first_name} {patient.last_name}
            </span>
          </motion.button>
        ))}
      </div>

      {statusMessage ? (
        <p className="rounded-xl border border-alabaster-grey-500/20 bg-ink-black-950 p-4 text-sm leading-6 text-alabaster-grey-500">
          {statusMessage}
        </p>
      ) : null}
    </section>
  );

  async function handleSelectById(patientId: number) {
    setLoadingPatientId(patientId);
    try {
      const openedPatient = await openPatientRecord(sessionToken, patientId);
      onPatientSelect(openedPatient);
    } catch {
      setStatusMessage(t("mobileSearchError"));
    } finally {
      setLoadingPatientId(null);
    }
  }
}

function QuickPatients({
  appointments,
  loadingPatientId,
  onSelect
}: {
  appointments: Appointment[];
  loadingPatientId: number | null;
  onSelect: (patientId: number) => void;
}) {
  const { t } = useL10n();
  const morning = quickPatientsForPeriod(appointments, "morning");
  const afternoon = quickPatientsForPeriod(appointments, "afternoon");
  const sections = new Date().getHours() < 13
    ? [
        { key: "morning", label: t("mobileTodayMorningPatients"), rows: morning },
        { key: "afternoon", label: t("mobileTodayAfternoonPatients"), rows: afternoon }
      ]
    : [
        { key: "afternoon", label: t("mobileTodayAfternoonPatients"), rows: afternoon },
        { key: "morning", label: t("mobileTodayMorningPatients"), rows: morning }
      ];

  return (
    <div className="grid gap-3">
      {sections.map((section) => section.rows.length ? (
        <div key={section.key} className="grid gap-2 rounded-xl border border-powder-blue-500/20 bg-powder-blue-950/20 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">{section.label}</p>
          <div className="grid gap-2">
            {section.rows.map((row) => (
              <button
                key={`${section.key}-${String(row.patientId)}`}
                className="min-h-14 rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 px-4 text-left text-base font-semibold text-white disabled:opacity-60"
                disabled={loadingPatientId !== null}
                type="button"
                onClick={() => onSelect(row.patientId)}
              >
                {row.name}
              </button>
            ))}
          </div>
        </div>
      ) : null)}
    </div>
  );
}

function quickPatientsForPeriod(appointments: Appointment[], period: "morning" | "afternoon") {
  const seen = new Set<number>();
  return appointments
    .filter((appointment) => appointment.patient_id !== null)
    .filter((appointment) => {
      const hour = Number(appointment.starts_at.slice(11, 13));
      return period === "morning" ? hour < 13 : hour >= 13;
    })
    .sort((left, right) => (left.patient_name ?? "").localeCompare(right.patient_name ?? ""))
    .flatMap((appointment) => {
      if (appointment.patient_id === null || seen.has(appointment.patient_id)) {
        return [];
      }
      seen.add(appointment.patient_id);
      return [{ patientId: appointment.patient_id, name: appointment.patient_name ?? String(appointment.patient_id) }];
    });
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
