import { CalendarClock, ChevronLeft, ChevronRight, LockKeyhole, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useL10n } from "@/frontend/shared/i18n/L10nProvider";
import type { L10nKey } from "@/frontend/shared/i18n/translations";
import { Badge } from "@/frontend/shared/ui/badge";
import { Button } from "@/frontend/shared/ui/button";
import { Input } from "@/frontend/shared/ui/input";
import type { User } from "@/frontend/settings/settingsApi";
import { isTauriRuntime, searchPatients, type Patient } from "@/frontend/patients/patientsApi";
import {
  createAgendaBlock,
  createAppointment,
  deleteAppointment,
  deleteAgendaBlock,
  getChairConfig,
  googleCalendarSyncStatus,
  listAgendaBlocks,
  listAppointments,
  moveAppointment,
  processGoogleCalendarSync,
  updateAppointmentStatus,
  type AgendaBlock,
  type Appointment,
  type AppointmentStatus,
  type GoogleCalendarSyncStatus
} from "./agendaApi";

const TIME_SLOTS = Array.from({ length: 24 }, (_, index) => {
  const totalMinutes = 8 * 60 + index * 30;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return {
    key: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
  };
});
const STATUS_OPTIONS: AppointmentStatus[] = ["booked", "arrived", "waiting", "in_chair", "completed", "cancelled"];
const DEFAULT_DURATION_MINUTES = 30;
const AGENDA_SYNC_POLL_MS = 20_000;

interface AgendaViewProps {
  currentUser: User | null;
}

export function AgendaView({ currentUser }: AgendaViewProps) {
  const { t } = useL10n();
  const [mode, setMode] = useState<"day" | "week">("day");
  const [anchorDate, setAnchorDate] = useState(todayDateInput());
  const [chairCount, setChairCount] = useState(1);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [agendaBlocks, setAgendaBlocks] = useState<AgendaBlock[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [syncStatus, setSyncStatus] = useState<GoogleCalendarSyncStatus | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [patientQuery, setPatientQuery] = useState("");
  const [patientSuggestionsOpen, setPatientSuggestionsOpen] = useState(false);
  const [showBlockForm, setShowBlockForm] = useState(false);
  const [timeTouched, setTimeTouched] = useState(false);
  const [appointmentSaving, setAppointmentSaving] = useState(false);
  const [form, setForm] = useState({
    patientId: "",
    title: t("agendaDefaultAppointmentTitle"),
    date: todayDateInput(),
    time: "09:00",
    duration: String(DEFAULT_DURATION_MINUTES),
    chairNumber: "1"
  });
  const [blockForm, setBlockForm] = useState({
    title: "",
    date: todayDateInput(),
    startTime: "09:00",
    endTime: "18:00",
    allDay: true
  });

  const safeAnchorDate = useMemo(() => normalizeDateInput(anchorDate), [anchorDate]);
  const range = useMemo(() => agendaRange(safeAnchorDate, mode), [safeAnchorDate, mode]);
  const visibleDays = useMemo(() => daysInRange(range.startDate, mode === "week" ? 7 : 1), [mode, range.startDate]);
  const chairNumbers = useMemo(() => Array.from({ length: chairCount }, (_, index) => index + 1), [chairCount]);
  const freePatientName = patientQuery.trim();
  const canCreateAppointment = Boolean(form.patientId || freePatientName);
  const calendarStatusKey = calendarSyncStatusKey(syncStatus);
  const calendarStatusVariant = calendarSyncStatusVariant(syncStatus);

  async function refreshAgenda() {
    if (!currentUser?.session_token) {
      return;
    }

    await processGoogleCalendarSync(currentUser.session_token).catch(() => undefined);

    const [chairs, rows, blocks, sync, patientRows] = await Promise.all([
      getChairConfig(currentUser.session_token),
      listAppointments(currentUser.session_token, range.startsFrom, range.startsTo),
      listAgendaBlocks(currentUser.session_token, range.startsFrom, range.startsTo),
      currentUser.role === "admin" ? googleCalendarSyncStatus(currentUser.session_token) : Promise.resolve(null),
      searchPatients(currentUser.session_token, "", 25)
    ]);

    setChairCount(chairs.chair_count);
    setAppointments(rows);
    setAgendaBlocks(blocks);
    setSyncStatus(sync);
    setPatients(patientRows);
  }

  async function handlePatientSearch(nextQuery: string) {
    setPatientQuery(nextQuery);
    setPatientSuggestionsOpen(true);
    setForm((current) => ({ ...current, patientId: "" }));
    if (!currentUser?.session_token) {
      return;
    }
    setPatients(await searchPatients(currentUser.session_token, nextQuery, 12));
  }

  function selectPatient(patient: Patient) {
    setForm((current) => ({ ...current, patientId: String(patient.id) }));
    setPatientQuery(`${patient.last_name} ${patient.first_name}`);
    setPatientSuggestionsOpen(false);
  }

  useEffect(() => {
    if (!currentUser?.session_token) {
      return;
    }

    void refreshAgenda().catch((error: unknown) => {
      setStatusMessage(error instanceof Error ? error.message : t("agendaGenericError"));
    });
  }, [currentUser, range.startsFrom, range.startsTo, t]);

  useEffect(() => {
    if (!currentUser?.session_token) {
      return;
    }

    let running = false;
    const intervalId = window.setInterval(() => {
      if (document.hidden || running) {
        return;
      }
      running = true;
      void refreshAgenda()
        .catch((error: unknown) => {
          setStatusMessage(error instanceof Error ? error.message : t("agendaGenericError"));
        })
        .finally(() => {
          running = false;
        });
    }, AGENDA_SYNC_POLL_MS);

    return () => window.clearInterval(intervalId);
  }, [currentUser?.session_token, range.startsFrom, range.startsTo, t]);

  useEffect(() => {
    if (timeTouched) {
      return;
    }
    const nextTime = nextFreeAppointmentTime(
      form.date,
      Number(form.chairNumber) || 1,
      appointments,
      Number(form.duration) || DEFAULT_DURATION_MINUTES
    );
    setForm((current) => current.time === nextTime ? current : { ...current, time: nextTime });
  }, [appointments, form.chairNumber, form.date, form.duration, timeTouched]);

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
    if (!currentUser?.session_token) {
      return;
    }
    if (appointmentSaving) {
      return;
    }
    if (!canCreateAppointment) {
      setStatusMessage(t("agendaPatientOrNameRequired"));
      return;
    }

    setAppointmentSaving(true);
    try {
      const startsAt = localDateTimeWithOffset(form.date, form.time);
      const endsAt = addMinutesLocalDateTime(form.date, form.time, Number(form.duration) || DEFAULT_DURATION_MINUTES);
      await createAppointment(currentUser.session_token, {
        patient_id: form.patientId ? Number(form.patientId) : undefined,
        chair_number: Number(form.chairNumber) || 1,
        title: form.patientId ? form.title.trim() || t("agendaDefaultAppointmentTitle") : `${freePatientName} - ${t("agendaFirstVisitTitle")}`,
        starts_at: startsAt,
        ends_at: endsAt,
        status: "booked",
        color_tag: "powder_blue",
        notes: form.patientId ? undefined : t("agendaFirstVisitTitle")
      });
      setStatusMessage(t("agendaAppointmentCreated"));
      setForm({ ...form, title: t("agendaDefaultAppointmentTitle") });
      setTimeTouched(false);
      await refreshAgenda();
    } finally {
      setAppointmentSaving(false);
    }
  }

  async function handleCreateBlock() {
    if (currentUser?.role !== "admin" || !currentUser.session_token) {
      return;
    }

    const startsAt = blockForm.allDay
      ? localDateTimeWithOffset(blockForm.date, "00:00")
      : localDateTimeWithOffset(blockForm.date, blockForm.startTime);
    const endsAt = blockForm.allDay
      ? localDateTimeWithOffset(shiftDate(blockForm.date, 1), "00:00")
      : localDateTimeWithOffset(blockForm.date, blockForm.endTime);

    await createAgendaBlock(currentUser.session_token, {
      title: blockForm.title.trim() || t("agendaClosedBadge"),
      starts_at: startsAt,
      ends_at: endsAt,
      all_day: blockForm.allDay
    });
    setBlockForm({ ...blockForm, title: "" });
    setStatusMessage(t("agendaBlockCreated"));
    await refreshAgenda();
  }

  async function handleDeleteBlock(blockId: number) {
    if (currentUser?.role !== "admin" || !currentUser.session_token) {
      return;
    }
    await deleteAgendaBlock(currentUser.session_token, blockId);
    setStatusMessage(t("agendaBlockDeleted"));
    await refreshAgenda();
  }

  async function handleDrop(targetDate: string, chairNumber: number, time: string, data: string) {
    if (!currentUser?.session_token || !data) {
      return;
    }

    const [appointmentId, duration] = data.split(":").map(Number);
    if (!appointmentId || !duration) {
      return;
    }

    const startsAt = localDateTimeWithOffset(targetDate, time);
    const endsAt = addMinutesLocalDateTime(targetDate, time, duration);
    await moveAppointment(currentUser.session_token, appointmentId, chairNumber, startsAt, endsAt);
    setStatusMessage(t("agendaAppointmentMoved"));
    await refreshAgenda();
  }

  async function handleStatusChange(appointment: Appointment, status: AppointmentStatus) {
    if (!currentUser?.session_token) {
      return;
    }
    if (status === "cancelled") {
      await deleteAppointment(currentUser.session_token, appointment.id);
      setAppointments((current) => current.filter((item) => item.id !== appointment.id));
      setStatusMessage(t("agendaAppointmentDeleted"));
      await refreshAgenda();
      return;
    }
    setAppointments((current) => current.map((item) => item.id === appointment.id ? { ...item, status } : item));
    const updated = await updateAppointmentStatus(currentUser.session_token, appointment.id, status);
    setAppointments((current) => current.map((item) => item.id === updated.id ? updated : item));
    setStatusMessage(t("agendaStatusUpdated"));
    await refreshAgenda();
  }

  function selectAppointmentSlot(targetDate: string, chairNumber: number, time: string) {
    setAnchorDate(normalizeDateInput(targetDate));
    setTimeTouched(true);
    setForm((current) => ({
      ...current,
      chairNumber: String(chairNumber),
      date: targetDate,
      time
    }));
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageTitle eyebrow={t("agendaEyebrow")} title={t("agendaTitle")} />
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={calendarStatusVariant}>
            {t(calendarStatusKey)}
          </Badge>
          <Badge variant="default">
            {t("agendaQueuedJobs")}: {syncStatus?.queued_jobs ?? 0}
          </Badge>
        </div>
      </div>

      <div className="grid items-end gap-3 border-y border-alabaster-grey-500/15 py-3 xl:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid items-end gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(190px,1.2fr)_minmax(180px,1fr)_minmax(150px,0.8fr)_minmax(118px,0.62fr)_minmax(120px,0.62fr)_minmax(150px,0.75fr)]">
          <div className="relative">
            <Input
              placeholder={t("agendaPatientRequiredPlaceholder")}
              type="search"
              value={patientQuery}
              onBlur={() => window.setTimeout(() => setPatientSuggestionsOpen(false), 120)}
              onChange={(event) => void handlePatientSearch(event.target.value).catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("patientsGenericError")))}
              onFocus={() => setPatientSuggestionsOpen(true)}
            />
            {patientSuggestionsOpen && patients.length > 0 ? (
              <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-powder-blue-500/30 bg-ink-black-950 shadow-[0_20px_44px_rgba(0,0,0,0.42)]">
                {freePatientName && !patients.some((patient) => `${patient.last_name} ${patient.first_name}`.toLowerCase() === freePatientName.toLowerCase()) ? (
                  <div className="border-b border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-100">
                    {t("agendaUnregisteredPatientHint")}
                  </div>
                ) : null}
                {patients.map((patient) => (
                  <button
                    key={patient.id}
                    className="block min-h-12 w-full border-b border-alabaster-grey-500/10 px-3 py-2 text-left text-sm text-white last:border-b-0 hover:bg-powder-blue-950"
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
          <Input type="date" value={form.date} onChange={(event) => {
            const nextDate = event.target.value;
            if (!isValidDateInput(nextDate)) {
              return;
            }
            setTimeTouched(false);
            setForm({ ...form, date: nextDate });
          }} />
          <Input type="time" value={form.time} onChange={(event) => {
            setTimeTouched(true);
            setForm({ ...form, time: event.target.value });
          }} />
          <div className="relative">
            <span className="pointer-events-none absolute -top-2 left-3 z-10 rounded bg-ink-black-950 px-1 text-[9px] font-semibold uppercase tracking-widest text-alabaster-grey-500">
              {t("agendaDurationLabel")}
            </span>
            <Input className="h-10 pt-2" type="number" min={15} step={15} value={form.duration} onChange={(event) => {
              setTimeTouched(false);
              setForm({ ...form, duration: event.target.value });
            }} />
          </div>
          <select
            className="h-10 rounded-md border border-alabaster-grey-500/20 bg-ink-black-900 px-3 text-sm text-white outline-none focus:border-powder-blue-500"
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
          disabled={!canCreateAppointment || appointmentSaving}
          title={!canCreateAppointment ? t("agendaPatientOrNameTooltip") : undefined}
          type="button"
          className="h-10 whitespace-nowrap"
          onClick={() => void handleCreateAppointment()}
        >
          <CalendarClock aria-hidden="true" className="h-4 w-4" />
          {t("agendaCreateAppointment")}
        </Button>
      </div>

      {currentUser.role === "admin" ? (
        <div className="grid gap-3">
          <div>
            <Button type="button" variant="secondary" onClick={() => setShowBlockForm((current) => !current)}>
              <LockKeyhole aria-hidden="true" className="h-4 w-4" />
              {t("agendaClosureToggle")}
            </Button>
          </div>
          {showBlockForm ? (
            <div className="grid gap-3 rounded-md border border-alabaster-grey-500/20 bg-glaucous-950 p-3 xl:grid-cols-[1fr_auto]">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
                <Input placeholder={t("agendaBlockTitle")} value={blockForm.title} onChange={(event) => setBlockForm({ ...blockForm, title: event.target.value })} />
                <Input type="date" value={blockForm.date} onChange={(event) => {
                  const nextDate = event.target.value;
                  if (isValidDateInput(nextDate)) {
                    setBlockForm({ ...blockForm, date: nextDate });
                  }
                }} />
                <Input type="time" disabled={blockForm.allDay} value={blockForm.startTime} onChange={(event) => setBlockForm({ ...blockForm, startTime: event.target.value })} />
                <Input type="time" disabled={blockForm.allDay} value={blockForm.endTime} onChange={(event) => setBlockForm({ ...blockForm, endTime: event.target.value })} />
                <label className="flex h-10 items-center gap-2 rounded-md border border-alabaster-grey-500/20 bg-ink-black-900 px-3 text-sm text-alabaster-grey-500">
                  <input
                    checked={blockForm.allDay}
                    className="h-4 w-4 accent-powder-blue-500"
                    type="checkbox"
                    onChange={(event) => setBlockForm({ ...blockForm, allDay: event.target.checked })}
                  />
                  {t("agendaBlockAllDay")}
                </label>
              </div>
              <Button type="button" variant="secondary" onClick={() => void handleCreateBlock().catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("agendaGenericError")))}>
                <LockKeyhole aria-hidden="true" className="h-4 w-4" />
                {t("agendaCreateBlock")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {agendaBlocks.length > 0 ? (
        <div className="grid gap-2 rounded-md border border-powder-blue-500/20 bg-ink-black-950 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-pale-sky-500">
            <LockKeyhole aria-hidden="true" className="h-4 w-4" />
            {t("agendaBlocksTitle")}
          </div>
          <div className="grid gap-2 lg:grid-cols-2">
            {agendaBlocks.map((block) => (
              <div key={block.id} className="flex items-center justify-between gap-3 rounded-md border border-alabaster-grey-500/15 bg-glaucous-950 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{block.title}</p>
                  <p className="mt-1 font-mono text-xs text-alabaster-grey-500">{formatBlockTime(block)}</p>
                </div>
                {currentUser.role === "admin" ? (
                  <Button type="button" variant="secondary" size="icon" className="h-9 w-9 justify-center p-0" aria-label={t("agendaDeleteBlock")} onClick={() => void handleDeleteBlock(block.id).catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("agendaGenericError")))}>
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" size="icon" aria-label={t("agendaPrevious")} onClick={() => setAnchorDate(shiftDate(safeAnchorDate, mode === "week" ? -7 : -1))}>
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          </Button>
          <Input className="w-[168px]" type="date" value={safeAnchorDate} onChange={(event) => {
            const nextDate = event.target.value;
            if (isValidDateInput(nextDate)) {
              setAnchorDate(nextDate);
            }
          }} />
          <Button type="button" variant="secondary" size="icon" aria-label={t("agendaNext")} onClick={() => setAnchorDate(shiftDate(safeAnchorDate, mode === "week" ? 7 : 1))}>
            <ChevronRight aria-hidden="true" className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid justify-items-end gap-2">
          {mode === "week" ? <WeekAvailabilitySummary appointments={appointments} blocks={agendaBlocks} days={visibleDays} t={t} /> : null}
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
                {TIME_SLOTS.map((slot) => (
                  <AgendaTimeSlotRow
                    key={`${day}-${slot.key}`}
                    appointments={appointmentsForSlot(appointments, day, slot.key)}
                    blocks={blocksForSlot(agendaBlocks, day, slot.key)}
                    chairNumbers={chairNumbers}
                    day={day}
                    slot={slot}
                    onSlotSelect={selectAppointmentSlot}
                    onDrop={(targetDate, chairNumber, targetTime, data) => void handleDrop(targetDate, chairNumber, targetTime, data).catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("agendaGenericError")))}
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

function calendarSyncStatusKey(status: GoogleCalendarSyncStatus | null): L10nKey {
  if (!status?.connected) {
    return "agendaCalendarDisconnected";
  }
  if (status.failed_jobs > 0) {
    return "agendaCalendarNeedsReview";
  }
  if (status.queued_jobs > 0) {
    return "agendaCalendarUpdating";
  }
  return "agendaCalendarConnected";
}

function calendarSyncStatusVariant(status: GoogleCalendarSyncStatus | null): "success" | "warning" | "danger" {
  if (!status?.connected) {
    return "warning";
  }
  if (status.failed_jobs > 0) {
    return "danger";
  }
  if (status.queued_jobs > 0) {
    return "warning";
  }
  return "success";
}

function AgendaTimeSlotRow({
  appointments,
  blocks,
  chairNumbers,
  day,
  slot,
  onDrop,
  onStatusChange,
  onSlotSelect,
  t
}: {
  appointments: Appointment[];
  blocks: AgendaBlock[];
  chairNumbers: number[];
  day: string;
  slot: { key: string; label: string };
  onDrop: (day: string, chairNumber: number, time: string, data: string) => void;
  onStatusChange: (appointment: Appointment, status: AppointmentStatus) => void;
  onSlotSelect: (day: string, chairNumber: number, time: string) => void;
  t: (key: L10nKey) => string;
}) {
  return (
    <>
      <div className="border-t border-alabaster-grey-500/10 py-2 font-mono text-xs text-alabaster-grey-500">
        {slot.label}
      </div>
      {chairNumbers.map((chair) => (
        <div
          key={`${day}-${slot.key}-${String(chair)}`}
          className="min-h-[78px] border-t border-alabaster-grey-500/10 p-1"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            onDrop(day, chair, slot.key, event.dataTransfer.getData("text/plain"));
          }}
          onClick={() => onSlotSelect(day, chair, slot.key)}
        >
          <div className="grid gap-1">
            {blocks.length > 0 ? (
              <div className="rounded-md border border-powder-blue-500/30 bg-powder-blue-950 px-2 py-1 text-[11px] font-semibold text-powder-blue-500">
                {t("agendaClosedBadge")}
              </div>
            ) : null}
            {appointments
              .filter((appointment) => appointment.chair_number === chair)
              .map((appointment) => (
                <div
                  key={appointment.id}
                  draggable
                  className={`rounded-md border p-2 shadow-[0_10px_26px_rgba(0,0,0,0.18)] ${appointmentStatusClass(appointment.status)}`}
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
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
                    aria-label={t("agendaChangeStatus")}
                    className="mt-2 h-8 w-full rounded-md border border-white/10 bg-ink-black-950/65 px-2 text-[11px] font-semibold text-white outline-none transition-colors hover:border-powder-blue-500/45 focus:border-powder-blue-500 focus:ring-2 focus:ring-powder-blue-500/20"
                    value={appointment.status}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => {
                      event.stopPropagation();
                      onStatusChange(appointment, event.target.value as AppointmentStatus);
                    }}
                  >
                    {STATUS_OPTIONS.map((status) => (
                      <option
                        key={status}
                        className={status === "cancelled" ? "bg-ink-black-950 text-red-400" : "bg-ink-black-950 text-white"}
                        value={status}
                      >
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

function WeekAvailabilitySummary({ appointments, blocks, days, t }: { appointments: Appointment[]; blocks: AgendaBlock[]; days: string[]; t: (key: L10nKey) => string }) {
  return (
    <div aria-label={t("agendaModeWeek")} className="grid grid-cols-7 gap-1 rounded-md border border-alabaster-grey-500/20 bg-ink-black-950 px-2 py-2">
      {days.map((day) => (
        <div key={day} className="grid min-w-9 justify-items-center gap-1">
          <span className="text-[9px] font-semibold uppercase text-alabaster-grey-500">{formatDayLabel(day).slice(0, 3)}</span>
          <div className="grid grid-cols-3 gap-0.5">
            {TIME_SLOTS.map((slot) => {
              const hasAppointments = appointmentsForSlot(appointments, day, slot.key).length > 0;
              const hasClosure = blocksForSlot(blocks, day, slot.key).length > 0;
              return (
                <span
                  key={`${day}-${slot.key}`}
                  className={`h-1.5 w-1.5 rounded-full ${hasClosure ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.55)]" : hasAppointments ? "bg-powder-blue-500 shadow-[0_0_8px_rgba(56,142,216,0.55)]" : "border border-alabaster-grey-500/20 bg-transparent"}`}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function todayDateInput() {
  return toDateInput(new Date());
}

function agendaRange(anchorDate: string, mode: "day" | "week") {
  const normalizedAnchorDate = normalizeDateInput(anchorDate);
  const startDate = mode === "week" ? weekStart(normalizedAnchorDate) : normalizedAnchorDate;
  const endDate = shiftDate(startDate, mode === "week" ? 7 : 1);
  return {
    startDate,
    startsFrom: `${startDate}T00:00:00${localOffset(startDate, "00:00")}`,
    startsTo: `${endDate}T00:00:00${localOffset(endDate, "00:00")}`
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
  return new Date(`${normalizeDateInput(dateInput)}T00:00:00`);
}

function toDateInput(date: Date) {
  if (Number.isNaN(date.getTime())) {
    const fallback = new Date();
    return `${String(fallback.getFullYear())}-${String(fallback.getMonth() + 1).padStart(2, "0")}-${String(fallback.getDate()).padStart(2, "0")}`;
  }
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localDateTimeWithOffset(dateInput: string, timeInput: string) {
  const safeDate = normalizeDateInput(dateInput);
  const safeTime = normalizeTimeInput(timeInput);
  return `${safeDate}T${safeTime}:00${localOffset(safeDate, safeTime)}`;
}

function addMinutesLocalDateTime(dateInput: string, timeInput: string, minutes: number) {
  const safeDate = normalizeDateInput(dateInput);
  const safeTime = normalizeTimeInput(timeInput);
  const date = new Date(`${safeDate}T${safeTime}:00`);
  date.setMinutes(date.getMinutes() + minutes);
  return `${toDateInput(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:00${localOffset(toDateInput(date), `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`)}`;
}

function localOffset(dateInput: string, timeInput: string) {
  const safeDate = normalizeDateInput(dateInput);
  const safeTime = normalizeTimeInput(timeInput);
  const offsetMinutes = -new Date(`${safeDate}T${safeTime}:00`).getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

export function isValidDateInput(dateInput: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateInput);
  if (!match) {
    return false;
  }
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(`${dateInput}T00:00:00`);
  return !Number.isNaN(date.getTime())
    && date.getFullYear() === year
    && date.getMonth() + 1 === month
    && date.getDate() === day;
}

function normalizeDateInput(dateInput: string) {
  return isValidDateInput(dateInput) ? dateInput : todayDateInput();
}

function normalizeTimeInput(timeInput: string) {
  return /^\d{2}:\d{2}$/.test(timeInput) ? timeInput : "00:00";
}

function appointmentsForDay(appointments: Appointment[], day: string) {
  return appointments.filter((appointment) => appointment.starts_at.slice(0, 10) === day);
}

function appointmentsForSlot(appointments: Appointment[], day: string, time: string) {
  return appointmentsForDay(appointments, day).filter((appointment) => appointment.starts_at.slice(11, 16) === time);
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

function blocksForSlot(blocks: AgendaBlock[], day: string, time: string) {
  const slotStart = Date.parse(localDateTimeWithOffset(day, time));
  const slotEnd = Date.parse(addMinutesLocalDateTime(day, time, 30));
  return blocks.filter((block) => Date.parse(block.starts_at) < slotEnd && Date.parse(block.ends_at) > slotStart);
}

function appointmentDurationMinutes(appointment: Appointment) {
  return Math.max(DEFAULT_DURATION_MINUTES, Math.round((Date.parse(appointment.ends_at) - Date.parse(appointment.starts_at)) / 60000));
}

function formatAppointmentTime(appointment: Appointment) {
  return `${appointment.starts_at.slice(11, 16)}-${appointment.ends_at.slice(11, 16)}`;
}

function formatBlockTime(block: AgendaBlock) {
  if (block.all_day) {
    return `${block.starts_at.slice(0, 10)} ${block.ends_at.slice(0, 10)}`;
  }
  return `${block.starts_at.slice(0, 16).replace("T", " ")}-${block.ends_at.slice(11, 16)}`;
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

export const agendaDateUtilsForTests = {
  agendaRange,
  formatDayLabel,
  shiftDate
};
