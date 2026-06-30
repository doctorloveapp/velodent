import { CalendarClock, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  createAppointment,
  deleteAppointment,
  getChairConfig,
  listAppointments,
  updateAppointmentStatus,
  type Appointment,
  type AppointmentStatus
} from "@/frontend/agenda/agendaApi";
import { searchPatients, type Patient } from "@/frontend/patients/patientsApi";
import type { L10nKey } from "@/frontend/shared/i18n/translations";
import { useL10n } from "@/frontend/shared/i18n/L10nProvider";
import { Button } from "@/frontend/shared/ui/button";
import { Input } from "@/frontend/shared/ui/input";

interface MobileAgendaProps {
  sessionToken: string;
}

const DEFAULT_DURATION_MINUTES = 30;
const STATUS_OPTIONS: AppointmentStatus[] = ["booked", "arrived", "waiting", "in_chair", "completed", "cancelled"];

export function MobileAgenda({ sessionToken }: MobileAgendaProps) {
  const { t } = useL10n();
  const [date, setDate] = useState(todayDateInput());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [chairCount, setChairCount] = useState(1);
  const [statusMessage, setStatusMessage] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientQuery, setPatientQuery] = useState("");
  const [patientSuggestionsOpen, setPatientSuggestionsOpen] = useState(false);
  const [statusTarget, setStatusTarget] = useState<Appointment | null>(null);
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
  const chairNumbers = useMemo(() => Array.from({ length: chairCount }, (_, index) => index + 1), [chairCount]);
  const freePatientName = patientQuery.trim();
  const canCreateAppointment = Boolean(form.patientId || freePatientName);

  async function refresh() {
    if (!sessionToken) {
      return;
    }
    const [rows, chairs] = await Promise.all([
      listAppointments(sessionToken, range.from, range.to),
      getChairConfig(sessionToken).catch(() => ({ chair_count: 1 }))
    ]);
    setAppointments(rows);
    setChairCount(Math.max(1, chairs.chair_count));
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
    if (!canCreateAppointment) {
      setStatusMessage(t("agendaPatientOrNameRequired"));
      return;
    }
    const startsAt = localDateTimeWithOffset(date, form.time);
    const endsAt = addMinutesLocalDateTime(date, form.time, Number(form.duration) || DEFAULT_DURATION_MINUTES);
    await createAppointment(sessionToken, {
      patient_id: form.patientId ? Number(form.patientId) : undefined,
      chair_number: Number(form.chairNumber) || 1,
      color_tag: "powder_blue",
      ends_at: endsAt,
      starts_at: startsAt,
      status: "booked",
      title: form.patientId ? form.title.trim() || t("agendaDefaultAppointmentTitle") : `${freePatientName} - ${t("agendaFirstVisitTitle")}`,
      notes: form.patientId ? undefined : t("agendaFirstVisitTitle")
    });
    setForm((current) => ({ ...current, title: t("agendaDefaultAppointmentTitle") }));
    setTimeTouched(false);
    setStatusMessage(t("agendaAppointmentCreated"));
    await refresh();
  }

  async function handleStatusChange(appointment: Appointment, status: AppointmentStatus) {
    if (!sessionToken) {
      return;
    }
    if (status === "cancelled") {
      await deleteAppointment(sessionToken, appointment.id);
      setAppointments((current) => current.filter((item) => item.id !== appointment.id));
      setStatusMessage(t("agendaAppointmentDeleted"));
      setStatusTarget(null);
      await refresh();
      return;
    }
    const updated = await updateAppointmentStatus(sessionToken, appointment.id, status);
    setAppointments((current) => current.map((item) => item.id === updated.id ? updated : item));
    setStatusMessage(t("agendaStatusUpdated"));
    setStatusTarget(null);
    await refresh();
  }

  return (
    <section className="grid max-w-full gap-4 overflow-x-hidden">
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
                {freePatientName && !patients.some((patient) => `${patient.last_name} ${patient.first_name}`.toLowerCase() === freePatientName.toLowerCase()) ? (
                  <div className="border-b border-amber-400/20 bg-amber-400/10 px-3 py-3 text-sm font-semibold text-amber-100">
                    {t("agendaUnregisteredPatientHint")}
                  </div>
                ) : null}
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
          <div className="grid min-w-0 gap-2 min-[420px]:grid-cols-3">
            <Input type="time" value={form.time} onChange={(event) => {
              setTimeTouched(true);
              setForm({ ...form, time: event.target.value });
            }} />
            <label className="grid gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-alabaster-grey-500">{t("agendaDurationLabel")}</span>
              <Input min={15} step={15} type="number" value={form.duration} onChange={(event) => {
                setTimeTouched(false);
                setForm({ ...form, duration: event.target.value });
              }} />
            </label>
            <select
              className="h-12 rounded-md border border-alabaster-grey-500/20 bg-ink-black-900 px-3 text-sm text-white outline-none focus:border-powder-blue-500"
              value={form.chairNumber}
              onChange={(event) => {
                setTimeTouched(false);
                setForm({ ...form, chairNumber: event.target.value });
              }}
            >
              {chairNumbers.map((chair) => (
                <option key={chair} value={chair}>
                  {t("agendaChair")} {String(chair)}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            className="h-14 justify-center text-base"
            disabled={!canCreateAppointment}
            title={!canCreateAppointment ? t("agendaPatientOrNameTooltip") : undefined}
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
            <article
              key={appointment.id}
              className="min-h-16 rounded-xl border border-alabaster-grey-500/20 bg-ink-black-950 p-4"
              onClick={() => setStatusTarget(appointment)}
            >
              <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-3">
                <div className="rounded-lg border border-powder-blue-500/25 bg-glaucous-950 px-2 py-2 text-center">
                  <CalendarClock aria-hidden="true" className="mx-auto h-4 w-4 text-powder-blue-500" strokeWidth={1.5} />
                  <p className="mt-1 whitespace-nowrap font-mono text-sm text-powder-blue-100">{appointment.starts_at.slice(11, 16)}</p>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-white">{appointment.title}</p>
                  <p className="mt-1 truncate text-sm text-alabaster-grey-500">{appointment.patient_name ?? t("agendaNoPatient")}</p>
                  <p className="mt-2 text-xs text-alabaster-grey-500">{t("agendaChair")} {String(appointment.chair_number)}</p>
                </div>
              </div>
            </article>
          ))
        ) : (
          <p className="rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-4 text-sm text-alabaster-grey-500">
            {t("agendaAppointmentsEmpty")}
          </p>
        )}
      </div>
      {statusTarget ? (
        <div className="fixed inset-0 z-50 grid content-end bg-ink-black-950/72 p-3 backdrop-blur-sm">
          <div className="rounded-t-2xl border border-alabaster-grey-500/20 bg-glaucous-950 p-4 shadow-[0_-18px_44px_rgba(0,0,0,0.42)]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">{t("agendaChangeStatus")}</p>
                <p className="mt-1 truncate text-base font-semibold text-white">{statusTarget.title}</p>
              </div>
              <Button
                aria-label={t("agendaCloseStatusMenu")}
                className="h-10 w-10 justify-center p-0"
                type="button"
                variant="secondary"
                onClick={() => setStatusTarget(null)}
              >
                <X aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
              </Button>
            </div>
            <div className="grid gap-2">
              {STATUS_OPTIONS.map((status) => (
                <Button
                  key={status}
                  type="button"
                  variant={statusTarget.status === status ? "navActive" : "secondary"}
                  className={`h-12 justify-center text-base ${status === "cancelled" ? "border-red-500/35 text-red-300 hover:bg-red-500/15" : ""}`}
                  onClick={() => void handleStatusChange(statusTarget, status).catch(() => setStatusMessage(t("agendaGenericError")))}
                >
                  {t(appointmentStatusLabelKey(status))}
                </Button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
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

function appointmentStatusLabelKey(status: AppointmentStatus): L10nKey {
  switch (status) {
    case "arrived":
      return "agendaStatusArrived";
    case "waiting":
      return "agendaStatusWaiting";
    case "in_chair":
      return "agendaStatusInChair";
    case "completed":
      return "agendaStatusCompleted";
    case "cancelled":
      return "agendaStatusCancelled";
    default:
      return "agendaStatusBooked";
  }
}
