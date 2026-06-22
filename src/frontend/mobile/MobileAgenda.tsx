import { CalendarClock, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createAppointment, listAppointments, type Appointment } from "@/frontend/agenda/agendaApi";
import { searchPatients, type Patient } from "@/frontend/patients/patientsApi";
import { useL10n } from "@/frontend/shared/i18n/L10nProvider";
import { Button } from "@/frontend/shared/ui/button";
import { Input } from "@/frontend/shared/ui/input";

interface MobileAgendaProps {
  sessionToken: string;
}

const DEFAULT_DURATION_MINUTES = 30;

export function MobileAgenda({ sessionToken }: MobileAgendaProps) {
  const { t } = useL10n();
  const [date, setDate] = useState(todayDateInput());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientQuery, setPatientQuery] = useState("");
  const [patientSuggestionsOpen, setPatientSuggestionsOpen] = useState(false);
  const [timeTouched, setTimeTouched] = useState(false);
  const [form, setForm] = useState({
    patientId: "",
    chairNumber: "1",
    duration: String(DEFAULT_DURATION_MINUTES),
    time: "09:00",
    title: t("agendaDefaultAppointmentTitle")
  });
  const range = useMemo(() => ({
    from: `${date}T00:00:00${localOffset(date, "00:00")}`,
    to: `${shiftDate(date, 1)}T00:00:00${localOffset(shiftDate(date, 1), "00:00")}`
  }), [date]);

  async function refresh() {
    if (!sessionToken) {
      return;
    }
    setAppointments(await listAppointments(sessionToken, range.from, range.to));
  }

  async function handlePatientSearch(nextQuery: string) {
    setPatientQuery(nextQuery);
    setPatientSuggestionsOpen(true);
    setForm((current) => ({ ...current, patientId: "" }));
    if (!sessionToken) {
      return;
    }
    setPatients(await searchPatients(sessionToken, nextQuery, 12));
  }

  function selectPatient(patient: Patient) {
    setForm((current) => ({ ...current, patientId: String(patient.id) }));
    setPatientQuery(`${patient.last_name} ${patient.first_name}`);
    setPatientSuggestionsOpen(false);
  }

  useEffect(() => {
    void refresh().catch(() => setStatusMessage(t("agendaGenericError")));
  }, [range.from, range.to, sessionToken]);

  useEffect(() => {
    if (timeTouched) {
      return;
    }
    const nextTime = nextFreeAppointmentTime(date, Number(form.chairNumber) || 1, appointments, Number(form.duration) || DEFAULT_DURATION_MINUTES);
    setForm((current) => current.time === nextTime ? current : { ...current, time: nextTime });
  }, [appointments, date, form.chairNumber, form.duration, timeTouched]);

  async function handleCreateAppointment() {
    if (!form.patientId) {
      setStatusMessage(t("agendaPatientRequired"));
      return;
    }
    const startsAt = localDateTimeWithOffset(date, form.time);
    const endsAt = addMinutesLocalDateTime(date, form.time, Number(form.duration) || DEFAULT_DURATION_MINUTES);
    await createAppointment(sessionToken, {
      patient_id: Number(form.patientId),
      chair_number: Number(form.chairNumber) || 1,
      color_tag: "powder_blue",
      ends_at: endsAt,
      starts_at: startsAt,
      status: "booked",
      title: form.title.trim() || t("agendaDefaultAppointmentTitle")
    });
    setForm((current) => ({ ...current, title: t("agendaDefaultAppointmentTitle") }));
    setTimeTouched(false);
    setStatusMessage(t("agendaAppointmentCreated"));
    await refresh();
  }

  return (
    <section className="grid gap-4">
      <div className="rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">{t("agendaModeDay")}</p>
        <div className="mt-3 grid gap-2">
          <Input type="date" value={date} onChange={(event) => {
            setTimeTouched(false);
            setDate(event.target.value);
          }} />
          <div className="relative">
            <Input
              className="h-12"
              placeholder={t("agendaPatientRequiredPlaceholder")}
              type="search"
              value={patientQuery}
              onBlur={() => window.setTimeout(() => setPatientSuggestionsOpen(false), 120)}
              onChange={(event) => void handlePatientSearch(event.target.value).catch(() => setStatusMessage(t("patientsGenericError")))}
              onFocus={() => setPatientSuggestionsOpen(true)}
            />
            {patientSuggestionsOpen && patients.length > 0 ? (
              <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-powder-blue-500/30 bg-ink-black-950 shadow-[0_20px_44px_rgba(0,0,0,0.42)]">
                {patients.map((patient) => (
                  <button
                    key={patient.id}
                    className="block min-h-16 w-full border-b border-alabaster-grey-500/10 px-3 py-3 text-left text-base text-white last:border-b-0 hover:bg-powder-blue-950"
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectPatient(patient)}
                  >
                    <span className="font-semibold">{patient.last_name}</span> {patient.first_name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <Input placeholder={t("agendaAppointmentTitle")} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          <div className="grid grid-cols-3 gap-2">
            <Input type="time" value={form.time} onChange={(event) => {
              setTimeTouched(true);
              setForm({ ...form, time: event.target.value });
            }} />
            <Input min={15} step={15} type="number" value={form.duration} onChange={(event) => {
              setTimeTouched(false);
              setForm({ ...form, duration: event.target.value });
            }} />
            <Input min={1} type="number" value={form.chairNumber} onChange={(event) => {
              setTimeTouched(false);
              setForm({ ...form, chairNumber: event.target.value });
            }} />
          </div>
          <Button
            type="button"
            className="h-14 justify-center text-base"
            disabled={!form.patientId}
            title={!form.patientId ? t("agendaPatientRequiredTooltip") : undefined}
            onClick={() => void handleCreateAppointment().catch(() => setStatusMessage(t("agendaGenericError")))}
          >
            <Plus aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
            {t("agendaCreateAppointment")}
          </Button>
        </div>
      </div>

      <div className="grid gap-2">
        {appointments.length ? (
          appointments.map((appointment) => (
            <article key={appointment.id} className="min-h-16 rounded-xl border border-alabaster-grey-500/20 bg-ink-black-950 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-white">{appointment.title}</p>
                  <p className="mt-1 truncate text-sm text-alabaster-grey-500">{appointment.patient_name ?? t("agendaNoPatient")}</p>
                </div>
                <div className="shrink-0 text-right">
                  <CalendarClock aria-hidden="true" className="ml-auto h-5 w-5 text-powder-blue-500" strokeWidth={1.5} />
                  <p className="mt-1 font-mono text-xs text-powder-blue-100">{appointment.starts_at.slice(11, 16)}</p>
                </div>
              </div>
              <p className="mt-2 text-xs text-alabaster-grey-500">{t("agendaChair")} {String(appointment.chair_number)}</p>
            </article>
          ))
        ) : (
          <p className="rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-4 text-sm text-alabaster-grey-500">
            {t("agendaAppointmentsEmpty")}
          </p>
        )}
      </div>
      {statusMessage ? <p className="text-sm text-powder-blue-500">{statusMessage}</p> : null}
    </section>
  );
}

function todayDateInput() {
  return toDateInput(new Date());
}

function shiftDate(dateInput: string, days: number) {
  const date = new Date(`${dateInput}T00:00:00`);
  date.setDate(date.getDate() + days);
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localDateTimeWithOffset(dateInput: string, timeInput: string) {
  return `${dateInput}T${timeInput}:00${localOffset(dateInput, timeInput)}`;
}

function addMinutesLocalDateTime(dateInput: string, timeInput: string, minutes: number) {
  const date = new Date(`${dateInput}T${timeInput}:00`);
  date.setMinutes(date.getMinutes() + minutes);
  const nextDate = toDateInput(date);
  const nextTime = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${nextDate}T${nextTime}:00${localOffset(nextDate, nextTime)}`;
}

function toDateInput(date: Date) {
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function appointmentsForDay(appointments: Appointment[], day: string) {
  return appointments.filter((appointment) => appointment.starts_at.slice(0, 10) === day);
}

function nextFreeAppointmentTime(dateInput: string, chairNumber: number, appointments: Appointment[], durationMinutes: number) {
  for (let hour = 9; hour < 18; hour += 1) {
    for (const minute of [0, 30]) {
      const candidate = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      if (!appointmentOverlaps(dateInput, candidate, chairNumber, appointments, durationMinutes)) {
        return candidate;
      }
    }
  }
  return "09:00";
}

function appointmentOverlaps(dateInput: string, timeInput: string, chairNumber: number, appointments: Appointment[], durationMinutes: number) {
  const start = Date.parse(localDateTimeWithOffset(dateInput, timeInput));
  const end = Date.parse(addMinutesLocalDateTime(dateInput, timeInput, durationMinutes));
  return appointmentsForDay(appointments, dateInput)
    .filter((appointment) => appointment.chair_number === chairNumber && appointment.status !== "cancelled")
    .some((appointment) => Date.parse(appointment.starts_at) < end && Date.parse(appointment.ends_at) > start);
}

function localOffset(dateInput: string, timeInput: string) {
  const offsetMinutes = -new Date(`${dateInput}T${timeInput}:00`).getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}
