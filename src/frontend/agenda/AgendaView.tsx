import { CalendarClock, ChevronLeft, ChevronRight, ExternalLink, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useL10n } from "@/frontend/shared/i18n/L10nProvider";
import type { L10nKey } from "@/frontend/shared/i18n/translations";
import { Badge } from "@/frontend/shared/ui/badge";
import { Button } from "@/frontend/shared/ui/button";
import { Input } from "@/frontend/shared/ui/input";
import type { User } from "@/frontend/settings/settingsApi";
import { isTauriRuntime, searchPatients, type Patient } from "@/frontend/patients/patientsApi";
import {
  createAppointment,
  getChairConfig,
  googleCalendarAuthorizationUrl,
  googleCalendarSyncStatus,
  listAppointments,
  moveAppointment,
  processGoogleCalendarSync,
  updateAppointmentStatus,
  type Appointment,
  type AppointmentStatus,
  type GoogleCalendarSyncStatus
} from "./agendaApi";

const HOURS = Array.from({ length: 12 }, (_, index) => index + 8);
const STATUS_OPTIONS: AppointmentStatus[] = ["booked", "arrived", "waiting", "in_chair", "completed", "cancelled"];
const DEFAULT_DURATION_MINUTES = 30;

interface AgendaViewProps {
  currentUser: User | null;
}

export function AgendaView({ currentUser }: AgendaViewProps) {
  const { t } = useL10n();
  const [mode, setMode] = useState<"day" | "week">("day");
  const [anchorDate, setAnchorDate] = useState(todayDateInput());
  const [chairCount, setChairCount] = useState(1);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [syncStatus, setSyncStatus] = useState<GoogleCalendarSyncStatus | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [form, setForm] = useState({
    patientId: "",
    title: "",
    date: todayDateInput(),
    time: "09:00",
    duration: String(DEFAULT_DURATION_MINUTES),
    chairNumber: "1"
  });

  const range = useMemo(() => agendaRange(anchorDate, mode), [anchorDate, mode]);
  const visibleDays = useMemo(() => daysInRange(range.startDate, mode === "week" ? 7 : 1), [mode, range.startDate]);
  const chairNumbers = useMemo(() => Array.from({ length: chairCount }, (_, index) => index + 1), [chairCount]);

  async function refreshAgenda() {
    if (!currentUser) {
      return;
    }

    const [chairs, rows, sync, patientRows] = await Promise.all([
      getChairConfig(currentUser.id),
      listAppointments(currentUser.id, range.startsFrom, range.startsTo),
      currentUser.role === "admin" ? googleCalendarSyncStatus(currentUser.id) : Promise.resolve(null),
      searchPatients("", 25)
    ]);

    setChairCount(chairs.chair_count);
    setAppointments(rows);
    setSyncStatus(sync);
    setPatients(patientRows);
  }

  useEffect(() => {
    if (!currentUser) {
      return;
    }

    void refreshAgenda().catch((error: unknown) => {
      setStatusMessage(error instanceof Error ? error.message : t("agendaGenericError"));
    });
  }, [currentUser, range.startsFrom, range.startsTo, t]);

  if (!isTauriRuntime()) {
    return (
      <section className="grid gap-4">
        <PageTitle eyebrow={t("agendaEyebrow")} title={t("agendaTitle")} />
        <p className="text-sm text-alabaster-grey-500">{t("agendaTauriUnavailable")}</p>
      </section>
    );
  }

  if (!currentUser) {
    return (
      <section className="grid gap-4">
        <PageTitle eyebrow={t("agendaEyebrow")} title={t("agendaTitle")} />
        <p className="text-sm text-alabaster-grey-500">{t("agendaLoginRequired")}</p>
      </section>
    );
  }

  async function handleCreateAppointment() {
    if (!currentUser) {
      return;
    }

    const startsAt = localDateTimeWithOffset(form.date, form.time);
    const endsAt = addMinutesLocalDateTime(form.date, form.time, Number(form.duration) || DEFAULT_DURATION_MINUTES);
    await createAppointment(currentUser.id, {
      patient_id: form.patientId ? Number(form.patientId) : undefined,
      chair_number: Number(form.chairNumber) || 1,
      title: form.title.trim(),
      starts_at: startsAt,
      ends_at: endsAt,
      status: "booked",
      color_tag: "powder_blue"
    });
    setStatusMessage(t("agendaAppointmentCreated"));
    setForm({ ...form, title: "" });
    await refreshAgenda();
  }

  async function handleDrop(targetDate: string, chairNumber: number, hour: number, data: string) {
    if (!currentUser || !data) {
      return;
    }

    const [appointmentId, duration] = data.split(":").map(Number);
    if (!appointmentId || !duration) {
      return;
    }

    const startsAt = localDateTimeWithOffset(targetDate, `${String(hour).padStart(2, "0")}:00`);
    const endsAt = addMinutesLocalDateTime(targetDate, `${String(hour).padStart(2, "0")}:00`, duration);
    await moveAppointment(currentUser.id, appointmentId, chairNumber, startsAt, endsAt);
    setStatusMessage(t("agendaAppointmentMoved"));
    await refreshAgenda();
  }

  async function handleStatusChange(appointment: Appointment, status: AppointmentStatus) {
    if (!currentUser) {
      return;
    }
    await updateAppointmentStatus(currentUser.id, appointment.id, status);
    setStatusMessage(t("agendaStatusUpdated"));
    await refreshAgenda();
  }

  async function handleGoogleAuthorize() {
    if (currentUser?.role !== "admin") {
      return;
    }
    const authorization = await googleCalendarAuthorizationUrl(currentUser.id);
    window.open(authorization.authorization_url, "_blank", "noopener,noreferrer");
    setStatusMessage(t("agendaGoogleAuthOpened"));
  }

  async function handleProcessSync() {
    if (currentUser?.role !== "admin") {
      return;
    }
    const result = await processGoogleCalendarSync(currentUser.id, 10);
    setStatusMessage(`${t("agendaSyncProcessed")}: ${String(result.processed)} / ${String(result.failed)}`);
    await refreshAgenda();
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageTitle eyebrow={t("agendaEyebrow")} title={t("agendaTitle")} />
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={syncStatus?.failed_jobs ? "danger" : syncStatus?.connected ? "success" : "warning"}>
            {syncStatus?.connected ? t("agendaGoogleConnected") : t("agendaGooglePending")}
          </Badge>
          <Badge variant="default">
            {t("agendaQueuedJobs")}: {syncStatus?.queued_jobs ?? 0}
          </Badge>
          {currentUser.role === "admin" ? (
            <>
              <Button type="button" variant="secondary" size="sm" onClick={() => void handleGoogleAuthorize()}>
                <ExternalLink aria-hidden="true" className="h-4 w-4" />
                {t("agendaAuthorizeGoogle")}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => void handleProcessSync()}>
                <RefreshCw aria-hidden="true" className="h-4 w-4" />
                {t("agendaProcessSync")}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 border-y border-alabaster-grey-500/15 py-3 xl:grid-cols-[1fr_auto]">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
          <select
            className="h-10 rounded-md border border-alabaster-grey-500/20 bg-ink-black-900 px-3 text-sm text-white outline-none focus:border-powder-blue-500"
            value={form.patientId}
            onChange={(event) => setForm({ ...form, patientId: event.target.value })}
          >
            <option value="">{t("agendaPatientOptional")}</option>
            {patients.map((patient) => (
              <option key={patient.id} value={patient.id}>
                {patient.last_name} {patient.first_name}
              </option>
            ))}
          </select>
          <Input placeholder={t("agendaAppointmentTitle")} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          <Input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
          <Input type="time" value={form.time} onChange={(event) => setForm({ ...form, time: event.target.value })} />
          <Input type="number" min={15} step={15} value={form.duration} onChange={(event) => setForm({ ...form, duration: event.target.value })} />
          <select
            className="h-10 rounded-md border border-alabaster-grey-500/20 bg-ink-black-900 px-3 text-sm text-white outline-none focus:border-powder-blue-500"
            value={form.chairNumber}
            onChange={(event) => setForm({ ...form, chairNumber: event.target.value })}
          >
            {chairNumbers.map((chair) => (
              <option key={chair} value={chair}>
                {t("agendaChair")} {String(chair)}
              </option>
            ))}
          </select>
        </div>
        <Button type="button" onClick={() => void handleCreateAppointment()}>
          <CalendarClock aria-hidden="true" className="h-4 w-4" />
          {t("agendaCreateAppointment")}
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" size="icon" aria-label={t("agendaPrevious")} onClick={() => setAnchorDate(shiftDate(anchorDate, mode === "week" ? -7 : -1))}>
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          </Button>
          <Input className="w-[168px]" type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)} />
          <Button type="button" variant="secondary" size="icon" aria-label={t("agendaNext")} onClick={() => setAnchorDate(shiftDate(anchorDate, mode === "week" ? 7 : 1))}>
            <ChevronRight aria-hidden="true" className="h-4 w-4" />
          </Button>
        </div>
        <div className="inline-flex rounded-md border border-alabaster-grey-500/20 bg-glaucous-950 p-1">
          {(["day", "week"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={`h-8 rounded px-3 text-xs font-semibold transition-colors ${mode === option ? "bg-powder-blue-500 text-white" : "text-alabaster-grey-500 hover:text-white"}`}
              onClick={() => setMode(option)}
            >
              {t(option === "day" ? "agendaModeDay" : "agendaModeWeek")}
            </button>
          ))}
        </div>
      </div>

      {statusMessage ? <p className="text-sm text-pale-sky-500">{statusMessage}</p> : null}

      <div className="overflow-x-auto">
        <div className="min-w-[980px]">
          {visibleDays.map((day) => (
            <div key={day} className="mb-5">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">{formatDayLabel(day)}</h3>
                <span className="font-mono text-xs text-alabaster-grey-500">{appointmentsForDay(appointments, day).length}</span>
              </div>
              <div className="grid gap-2" style={{ gridTemplateColumns: `72px repeat(${String(chairNumbers.length)}, minmax(180px, 1fr))` }}>
                <div />
                {chairNumbers.map((chair) => (
                  <div key={chair} className="rounded-md border border-alabaster-grey-500/20 bg-glaucous-950 px-3 py-2 text-xs font-semibold uppercase tracking-widest text-alabaster-grey-500">
                    {t("agendaChair")} {String(chair)}
                  </div>
                ))}
                {HOURS.map((hour) => (
                  <AgendaHourRow
                    key={`${day}-${String(hour)}`}
                    appointments={appointmentsForSlot(appointments, day, hour)}
                    chairNumbers={chairNumbers}
                    day={day}
                    hour={hour}
                    onDrop={(targetDate, chairNumber, targetHour, data) => void handleDrop(targetDate, chairNumber, targetHour, data).catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("agendaGenericError")))}
                    onStatusChange={(appointment, status) => void handleStatusChange(appointment, status).catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("agendaGenericError")))}
                    t={t}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function AgendaHourRow({
  appointments,
  chairNumbers,
  day,
  hour,
  onDrop,
  onStatusChange,
  t
}: {
  appointments: Appointment[];
  chairNumbers: number[];
  day: string;
  hour: number;
  onDrop: (day: string, chairNumber: number, hour: number, data: string) => void;
  onStatusChange: (appointment: Appointment, status: AppointmentStatus) => void;
  t: (key: L10nKey) => string;
}) {
  return (
    <>
      <div className="border-t border-alabaster-grey-500/10 py-2 font-mono text-xs text-alabaster-grey-500">
        {String(hour).padStart(2, "0")}:00
      </div>
      {chairNumbers.map((chair) => (
        <div
          key={`${day}-${String(hour)}-${String(chair)}`}
          className="min-h-[78px] border-t border-alabaster-grey-500/10 p-1"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            onDrop(day, chair, hour, event.dataTransfer.getData("text/plain"));
          }}
        >
          <div className="grid gap-1">
            {appointments
              .filter((appointment) => appointment.chair_number === chair)
              .map((appointment) => (
                <div
                  key={appointment.id}
                  draggable
                  className={`rounded-md border p-2 shadow-[0_10px_26px_rgba(0,0,0,0.18)] ${appointmentStatusClass(appointment.status)}`}
                  onDragStart={(event) => {
                    const duration = appointmentDurationMinutes(appointment);
                    event.dataTransfer.setData("text/plain", `${String(appointment.id)}:${String(duration)}`);
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-white">{appointment.title}</p>
                      <p className="mt-1 truncate text-[11px] text-white/70">
                        {appointment.patient_name ?? t("agendaNoPatient")}
                      </p>
                    </div>
                    <span className="font-mono text-[10px] text-white/70">{formatAppointmentTime(appointment)}</span>
                  </div>
                  <select
                    className="mt-2 h-7 w-full rounded border border-white/10 bg-ink-black-950/55 px-2 text-[11px] text-white outline-none"
                    value={appointment.status}
                    onChange={(event) => onStatusChange(appointment, event.target.value as AppointmentStatus)}
                  >
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {t(appointmentStatusLabelKey(status))}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
          </div>
        </div>
      ))}
    </>
  );
}

function PageTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">{eyebrow}</p>
      <h1 className="mt-2 text-2xl font-semibold text-white">{title}</h1>
    </div>
  );
}

function todayDateInput() {
  return new Date().toISOString().slice(0, 10);
}

function agendaRange(anchorDate: string, mode: "day" | "week") {
  const startDate = mode === "week" ? weekStart(anchorDate) : anchorDate;
  const endDate = shiftDate(startDate, mode === "week" ? 7 : 1);
  return {
    startDate,
    startsFrom: `${startDate}T00:00:00+02:00`,
    startsTo: `${endDate}T00:00:00+02:00`
  };
}

function weekStart(dateInput: string) {
  const date = dateFromInput(dateInput);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return toDateInput(date);
}

function shiftDate(dateInput: string, days: number) {
  const date = dateFromInput(dateInput);
  date.setDate(date.getDate() + days);
  return toDateInput(date);
}

function daysInRange(startDate: string, count: number) {
  return Array.from({ length: count }, (_, index) => shiftDate(startDate, index));
}

function dateFromInput(dateInput: string) {
  return new Date(`${dateInput}T00:00:00`);
}

function toDateInput(date: Date) {
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localDateTimeWithOffset(dateInput: string, timeInput: string) {
  return `${dateInput}T${timeInput}:00${localOffset(dateInput, timeInput)}`;
}

function addMinutesLocalDateTime(dateInput: string, timeInput: string, minutes: number) {
  const date = new Date(`${dateInput}T${timeInput}:00`);
  date.setMinutes(date.getMinutes() + minutes);
  return `${toDateInput(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:00${localOffset(toDateInput(date), `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`)}`;
}

function localOffset(dateInput: string, timeInput: string) {
  const offsetMinutes = -new Date(`${dateInput}T${timeInput}:00`).getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

function appointmentsForDay(appointments: Appointment[], day: string) {
  return appointments.filter((appointment) => appointment.starts_at.slice(0, 10) === day);
}

function appointmentsForSlot(appointments: Appointment[], day: string, hour: number) {
  return appointmentsForDay(appointments, day).filter((appointment) => Number(appointment.starts_at.slice(11, 13)) === hour);
}

function appointmentDurationMinutes(appointment: Appointment) {
  return Math.max(DEFAULT_DURATION_MINUTES, Math.round((Date.parse(appointment.ends_at) - Date.parse(appointment.starts_at)) / 60000));
}

function formatAppointmentTime(appointment: Appointment) {
  return `${appointment.starts_at.slice(11, 16)}-${appointment.ends_at.slice(11, 16)}`;
}

function formatDayLabel(dateInput: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", day: "2-digit", month: "2-digit" }).format(dateFromInput(dateInput));
}

function appointmentStatusClass(status: AppointmentStatus) {
  switch (status) {
    case "arrived":
      return "border-pale-sky-500/40 bg-pale-sky-500/18";
    case "waiting":
      return "border-amber-500/40 bg-amber-500/14";
    case "in_chair":
      return "border-powder-blue-500/50 bg-powder-blue-950";
    case "completed":
      return "border-emerald-500/40 bg-emerald-500/12";
    case "cancelled":
      return "border-rose-500/35 bg-rose-500/10 opacity-70";
    default:
      return "border-glaucous-500/45 bg-glaucous-950";
  }
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
