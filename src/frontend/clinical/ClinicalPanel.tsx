import { FilePlus2, ListFilter, Stethoscope } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/frontend/shared/ui/badge";
import { Button } from "@/frontend/shared/ui/button";
import { Input } from "@/frontend/shared/ui/input";
import { useL10n, type L10nKey } from "@/frontend/shared/i18n/L10nProvider";
import type { Patient } from "@/frontend/patients/patientsApi";
import type { User } from "@/frontend/settings/settingsApi";
import {
  createClinicalRecord,
  getToothStatuses,
  listClinicalRecords,
  listClinicalServices,
  markClinicalRecordReadyForQuote,
  openClinicalView,
  setToothStatus,
  type ClinicalRecord,
  type ClinicalRecordStatus,
  type ClinicalService,
  type ToothState,
  type ToothStatus
} from "./clinicalApi";

interface ClinicalPanelProps {
  currentUser: User | null;
  patient: Patient;
}

const upperRight = [18, 17, 16, 15, 14, 13, 12, 11];
const upperLeft = [21, 22, 23, 24, 25, 26, 27, 28];
const lowerRight = [48, 47, 46, 45, 44, 43, 42, 41];
const lowerLeft = [31, 32, 33, 34, 35, 36, 37, 38];
const diagnosisStates: ToothState[] = ["caries", "endodontics_needed", "crown_needed", "extraction_needed"];
const performedStates: ToothState[] = ["filling_done", "root_canal_done", "crown_done", "implant_done"];
const toothStates: ToothState[] = [...diagnosisStates, ...performedStates, "missing"];
const recordStatuses: ClinicalRecordStatus[] = ["diagnosed", "in_quote", "performed"];

const emptyRecordForm = {
  serviceId: "",
  toothNumber: "",
  toothSurface: "",
  pathologyDescription: "",
  status: "diagnosed" as ClinicalRecordStatus,
  readyForQuote: true,
  notes: ""
};

export function ClinicalPanel({ currentUser, patient }: ClinicalPanelProps) {
  const { t } = useL10n();
  const [services, setServices] = useState<ClinicalService[]>([]);
  const [toothStatuses, setToothStatuses] = useState<ToothStatus[]>([]);
  const [records, setRecords] = useState<ClinicalRecord[]>([]);
  const [selectedTooth, setSelectedTooth] = useState<number | null>(null);
  const [selectedToothState, setSelectedToothState] = useState<ToothState>("healthy");
  const [form, setForm] = useState(emptyRecordForm);
  const [filters, setFilters] = useState({ dateFrom: "", dateTo: "", toothNumber: "", operatorUserId: "" });
  const [statusMessage, setStatusMessage] = useState("");
  const [auditedPatientId, setAuditedPatientId] = useState<number | null>(null);

  const statusByTooth = useMemo(() => {
    return new Map<number, ToothState>(toothStatuses.map((entry) => [entry.tooth_number, entry.state]));
  }, [toothStatuses]);

  async function refreshClinicalData() {
    if (!currentUser) {
      return;
    }

    if (!currentUser.session_token) {
      return;
    }

    const [nextServices, nextToothStatuses, nextRecords] = await Promise.all([
      listClinicalServices(currentUser.session_token),
      getToothStatuses(currentUser.session_token, patient.id),
      listClinicalRecords(currentUser.session_token, patient.id, {
        date_from: filters.dateFrom || undefined,
        date_to: filters.dateTo || undefined,
        tooth_number: filters.toothNumber ? Number(filters.toothNumber) : undefined,
        operator_user_id: filters.operatorUserId ? Number(filters.operatorUserId) : undefined
      })
    ]);

    setServices(nextServices);
    setToothStatuses(nextToothStatuses);
    setRecords(nextRecords);
  }

  useEffect(() => {
    if (!currentUser) {
      return;
    }
    const user = currentUser;

    async function openAndRefresh() {
      if (auditedPatientId !== patient.id) {
        if (!user.session_token) {
          return;
        }
        await openClinicalView(user.session_token, patient.id);
        setAuditedPatientId(patient.id);
      }
      await refreshClinicalData();
    }

    void openAndRefresh().catch((error: unknown) => {
      setStatusMessage(error instanceof Error ? error.message : t("clinicalGenericError"));
    });
  }, [currentUser?.id, patient.id, auditedPatientId]);

  if (!currentUser) {
    return <p className="text-sm text-alabaster-grey-500">{t("clinicalLoginRequired")}</p>;
  }
  const activeUser = currentUser;

  function selectTooth(toothNumber: number) {
    const state = statusByTooth.get(toothNumber) ?? "healthy";
    setSelectedTooth(toothNumber);
    setSelectedToothState(state);
    setForm((current) => ({ ...current, toothNumber: String(toothNumber), readyForQuote: isDiagnosticState(state) }));
  }

  async function handleSetToothState(state: ToothState) {
    if (!selectedTooth) {
      setStatusMessage(t("clinicalSelectTooth"));
      return;
    }

    if (!activeUser.session_token) {
      setStatusMessage(t("clinicalLoginRequired"));
      return;
    }

    const saved = await setToothStatus(activeUser.session_token, patient.id, selectedTooth, state);
    setSelectedToothState(saved.state);
    setForm((current) => ({
      ...current,
      pathologyDescription: isDiagnosticState(state) ? t(toothStateKey(state)) : current.pathologyDescription,
      readyForQuote: isDiagnosticState(state),
      status: isPerformedState(state) ? "performed" : "diagnosed"
    }));
    if (isDiagnosticState(state) || isPerformedState(state)) {
      await createClinicalRecord(activeUser.session_token, {
        patient_id: patient.id,
        tooth_number: selectedTooth,
        pathology_description: t(toothStateKey(state)),
        status: isPerformedState(state) ? "performed" : "diagnosed",
        ready_for_quote: isDiagnosticState(state),
        notes: undefined
      });
    }
    setStatusMessage(t("clinicalToothStateSaved"));
    await refreshClinicalData();
  }

  async function handleCreateRecord() {
    if (!activeUser.session_token) {
      setStatusMessage(t("clinicalLoginRequired"));
      return;
    }

    const toothNumber = form.toothNumber ? Number(form.toothNumber) : undefined;
    const serviceId = form.serviceId ? Number(form.serviceId) : undefined;
    await createClinicalRecord(activeUser.session_token, {
      patient_id: patient.id,
      service_id: serviceId,
      tooth_number: toothNumber,
      tooth_surface: form.toothSurface || undefined,
      pathology_description: form.pathologyDescription || undefined,
      status: form.status,
      ready_for_quote: form.status === "diagnosed" && form.readyForQuote,
      notes: form.notes || undefined
    });

    setForm({ ...emptyRecordForm, toothNumber: toothNumber ? String(toothNumber) : "" });
    setStatusMessage(t("clinicalRecordCreated"));
    await refreshClinicalData();
  }

  async function handleFilter() {
    await refreshClinicalData();
  }

  async function handleToggleQuote(record: ClinicalRecord) {
    if (!activeUser.session_token) {
      setStatusMessage(t("clinicalLoginRequired"));
      return;
    }

    const updated = await markClinicalRecordReadyForQuote(activeUser.session_token, record.id, !record.ready_for_quote);
    setRecords((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setStatusMessage(t("clinicalQuoteFlagUpdated"));
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">
            {t("clinicalOdontogramEyebrow")}
          </p>
          <h3 className="text-base font-semibold text-white">{t("clinicalOdontogramTitle")}</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          {toothStates.map((state) => (
            <Badge key={state} variant={stateBadgeVariant(state)}>
              {t(toothStateKey(state))}
            </Badge>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-md border border-alabaster-grey-500/20 bg-ink-black-950 p-4">
          <OdontogramRow teeth={[...upperRight, ...upperLeft]} onSelect={selectTooth} selectedTooth={selectedTooth} statusByTooth={statusByTooth} />
          <div className="my-3 h-px bg-alabaster-grey-500/20" />
          <OdontogramRow teeth={[...lowerRight, ...lowerLeft]} onSelect={selectTooth} selectedTooth={selectedTooth} statusByTooth={statusByTooth} />
        </section>

        <section className="rounded-md border border-alabaster-grey-500/20 bg-ink-black-950 p-4">
          <div className="flex items-center gap-2">
            <Stethoscope aria-hidden="true" className="h-4 w-4 text-powder-blue-500" strokeWidth={1.5} />
            <h4 className="text-sm font-semibold text-white">{t("clinicalQuickMenuTitle")}</h4>
          </div>
          <p className="mt-2 font-mono text-xs text-alabaster-grey-500">
            {selectedTooth ? `${t("clinicalSelectedTooth")}: ${String(selectedTooth)}` : t("clinicalSelectTooth")}
          </p>
          <div className="mt-3 grid gap-3">
            <ClinicalMenuGroup title={t("clinicalDiagnosisGroup")}>
              {diagnosisStates.map((state) => (
                <Button
                  key={state}
                  type="button"
                  variant={selectedToothState === state ? "navActive" : "secondary"}
                  size="sm"
                  onClick={() => void handleSetToothState(state)}
                >
                  {t(toothStateKey(state))}
                </Button>
              ))}
            </ClinicalMenuGroup>
            <ClinicalMenuGroup title={t("clinicalPerformedGroup")}>
              {performedStates.map((state) => (
                <Button
                  key={state}
                  type="button"
                  variant={selectedToothState === state ? "navActive" : "secondary"}
                  size="sm"
                  onClick={() => void handleSetToothState(state)}
                >
                  {t(toothStateKey(state))}
                </Button>
              ))}
            </ClinicalMenuGroup>
            <div>
              <Button
                key="missing"
                type="button"
                variant={selectedToothState === "missing" ? "navActive" : "secondary"}
                size="sm"
                className="w-full"
                onClick={() => void handleSetToothState("missing")}
              >
                {t("clinicalStateMissing")}
              </Button>
            </div>
          </div>
          {statusMessage ? <p className="mt-3 text-xs text-alabaster-grey-500">{statusMessage}</p> : null}
        </section>
      </div>

      <section className="rounded-md border border-alabaster-grey-500/20 bg-ink-black-950 p-4">
        <div className="mb-3 flex items-center gap-2">
          <FilePlus2 aria-hidden="true" className="h-4 w-4 text-powder-blue-500" strokeWidth={1.5} />
          <h4 className="text-sm font-semibold text-white">{t("clinicalRecordFormTitle")}</h4>
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-6">
          <select
            className="h-10 rounded-md border border-alabaster-grey-500/20 bg-glaucous-950 px-3 text-sm text-white outline-none focus:border-powder-blue-500 focus:ring-2 focus:ring-powder-blue-500/20"
            value={form.serviceId}
            onChange={(event) => setForm({ ...form, serviceId: event.target.value })}
          >
            <option value="">{t("clinicalNoService")}</option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
          <Input className="font-mono" placeholder={t("clinicalToothNumber")} value={form.toothNumber} onChange={(event) => setForm({ ...form, toothNumber: event.target.value })} />
          <Input placeholder={t("clinicalSurface")} value={form.toothSurface} onChange={(event) => setForm({ ...form, toothSurface: event.target.value })} />
          <select
            className="h-10 rounded-md border border-alabaster-grey-500/20 bg-glaucous-950 px-3 text-sm text-white outline-none focus:border-powder-blue-500 focus:ring-2 focus:ring-powder-blue-500/20"
            value={form.status}
            onChange={(event) => setForm({ ...form, status: event.target.value as ClinicalRecordStatus })}
          >
            {recordStatuses.map((status) => (
              <option key={status} value={status}>
                {t(recordStatusKey(status))}
              </option>
            ))}
          </select>
          <Input className="xl:col-span-2" placeholder={t("clinicalDiagnosis")} value={form.pathologyDescription} onChange={(event) => setForm({ ...form, pathologyDescription: event.target.value })} />
          <Input className="xl:col-span-5" placeholder={t("clinicalNotes")} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          <label className="flex h-10 items-center gap-2 rounded-md border border-alabaster-grey-500/20 bg-glaucous-950 px-3 text-sm text-alabaster-grey-500">
            <input
              checked={form.readyForQuote}
              className="h-4 w-4 accent-powder-blue-500"
              type="checkbox"
              onChange={(event) => setForm({ ...form, readyForQuote: event.target.checked })}
            />
            {t("clinicalReadyForQuote")}
          </label>
        </div>
        <div className="mt-3 flex justify-end">
          <Button type="button" onClick={() => void handleCreateRecord()}>
            {t("clinicalCreateRecord")}
          </Button>
        </div>
      </section>

      <section className="rounded-md border border-alabaster-grey-500/20 bg-ink-black-950 p-4">
        <div className="mb-3 flex items-center gap-2">
          <ListFilter aria-hidden="true" className="h-4 w-4 text-powder-blue-500" strokeWidth={1.5} />
          <h4 className="text-sm font-semibold text-white">{t("clinicalDiaryTitle")}</h4>
        </div>
        <div className="grid gap-2 md:grid-cols-5">
          <Input placeholder={t("clinicalDateFrom")} type="date" value={filters.dateFrom} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })} />
          <Input placeholder={t("clinicalDateTo")} type="date" value={filters.dateTo} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })} />
          <Input className="font-mono" placeholder={t("clinicalToothNumber")} value={filters.toothNumber} onChange={(event) => setFilters({ ...filters, toothNumber: event.target.value })} />
          <Input className="font-mono" placeholder={t("clinicalOperatorId")} value={filters.operatorUserId} onChange={(event) => setFilters({ ...filters, operatorUserId: event.target.value })} />
          <Button type="button" variant="secondary" onClick={() => void handleFilter()}>
            {t("clinicalApplyFilters")}
          </Button>
        </div>
        <div className="mt-4 overflow-hidden rounded-md border border-alabaster-grey-500/20">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-glaucous-950 text-[10px] uppercase tracking-widest text-alabaster-grey-500">
              <tr>
                <th className="px-3 py-2">{t("clinicalDiaryDate")}</th>
                <th className="px-3 py-2">{t("clinicalToothNumber")}</th>
                <th className="px-3 py-2">{t("clinicalService")}</th>
                <th className="px-3 py-2">{t("clinicalStatus")}</th>
                <th className="px-3 py-2">{t("clinicalOperator")}</th>
                <th className="px-3 py-2">{t("clinicalQuote")}</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-alabaster-grey-500" colSpan={6}>{t("clinicalDiaryEmpty")}</td>
                </tr>
              ) : (
                records.map((record) => (
                  <tr key={record.id} className="border-t border-alabaster-grey-500/10">
                    <td className="px-3 py-2 font-mono text-[11px] text-alabaster-grey-500">{record.created_at}</td>
                    <td className="px-3 py-2 font-mono text-white">{record.tooth_number ?? t("clinicalArch")}</td>
                    <td className="px-3 py-2 text-white">{record.service_name ?? t("clinicalNoService")}</td>
                    <td className="px-3 py-2 text-alabaster-grey-500">{t(recordStatusKey(record.status))}</td>
                    <td className="px-3 py-2 text-alabaster-grey-500">{record.operator_username ?? t("commonEmpty")}</td>
                    <td className="px-3 py-2">
                      {record.status === "diagnosed" ? (
                        <Button type="button" variant={record.ready_for_quote ? "navActive" : "secondary"} size="sm" onClick={() => void handleToggleQuote(record)}>
                          {record.ready_for_quote ? t("clinicalQuoteReady") : t("clinicalQuoteMark")}
                        </Button>
                      ) : (
                        <Badge variant="default">{t("clinicalQuoteNotEligible")}</Badge>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function OdontogramRow({
  onSelect,
  selectedTooth,
  statusByTooth,
  teeth
}: {
  onSelect: (toothNumber: number) => void;
  selectedTooth: number | null;
  statusByTooth: Map<number, ToothState>;
  teeth: number[];
}) {
  const { t } = useL10n();

  return (
    <div className="grid [grid-template-columns:repeat(16,minmax(0,1fr))] gap-1">
      {teeth.map((toothNumber) => {
        const state = statusByTooth.get(toothNumber) ?? "healthy";
        const selected = selectedTooth === toothNumber;

        return (
          <button
            key={toothNumber}
            aria-label={`${t("clinicalToothNumber")} ${String(toothNumber)}`}
            className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-md border px-1 py-2 transition-colors ${toothStateClass(state)} ${selected ? "ring-2 ring-powder-blue-500" : ""}`}
            type="button"
            onClick={() => onSelect(toothNumber)}
          >
            <ToothGlyph toothNumber={toothNumber} state={state} />
            <span className="font-mono text-[11px] font-semibold">{toothNumber}</span>
          </button>
        );
      })}
    </div>
  );
}

function ClinicalMenuGroup({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-alabaster-grey-500">{title}</p>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </div>
  );
}

function ToothGlyph({ state, toothNumber }: { state: ToothState; toothNumber: number }) {
  const position = toothNumber % 10;
  const missingClass = state === "missing" ? "opacity-10" : "";

  if (position <= 2) {
    return (
      <svg aria-hidden="true" className={`h-7 w-5 ${missingClass}`} fill="none" viewBox="0 0 24 30">
        <path d="M8 3.8c1.2-.8 2.6-.8 4-.2 1.4-.6 2.8-.6 4 .2 1.8 1.2 2.3 4.2 1.2 7.1-.8 2.1-1.2 4.4-1.4 7.2-.3 4.5-1.4 7.5-3.8 7.5s-3.5-3-3.8-7.5c-.2-2.8-.6-5.1-1.4-7.2-1.1-2.9-.6-5.9 1.2-7.1Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
        <path d="M9 10.2h6" stroke="currentColor" strokeLinecap="round" strokeWidth="1" />
      </svg>
    );
  }

  if (position === 3) {
    return (
      <svg aria-hidden="true" className={`h-7 w-5 ${missingClass}`} fill="none" viewBox="0 0 24 30">
        <path d="M7.2 3.5c1.5-1 3.2-.3 4.8-.3s3.3-.7 4.8.3c2 1.4 2.2 4.8.9 7.9-.9 2.1-1.7 4.9-2.3 8.4-.6 3.8-1.5 6.1-3.4 6.1s-2.8-2.3-3.4-6.1c-.6-3.5-1.4-6.3-2.3-8.4-1.3-3.1-1.1-6.5.9-7.9Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
        <path d="M12 12.5v9" stroke="currentColor" strokeLinecap="round" strokeWidth="1" />
      </svg>
    );
  }

  if (position <= 5) {
    return (
      <svg aria-hidden="true" className={`h-7 w-6 ${missingClass}`} fill="none" viewBox="0 0 26 30">
        <path d="M6.5 3.4c1.8-.9 3.9.1 6.5.1s4.7-1 6.5-.1c2.6 1.3 3.2 4.8 2.1 8.4-.7 2.3-1.9 4.1-2.5 7.2-.5 2.8-.9 6-3 6.4-1.7.3-2-3.8-3.1-3.8s-1.4 4.1-3.1 3.8c-2.1-.4-2.5-3.6-3-6.4-.6-3.1-1.8-4.9-2.5-7.2-1.1-3.6-.5-7.1 2.1-8.4Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
        <path d="M9.2 10.2h7.6M10 14.4h6" stroke="currentColor" strokeLinecap="round" strokeWidth="1" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className={`h-7 w-7 ${missingClass}`} fill="none" viewBox="0 0 30 30">
      <path d="M6.3 3.5c2.1-1 4.1.2 6.1.2 1.1 0 1.7-.5 2.6-.5s1.5.5 2.6.5c2 0 4-1.2 6.1-.2 2.9 1.4 3.6 5.1 2.3 9-.8 2.5-2.2 4.1-2.9 7.2-.6 2.8-1 5.8-3.3 6.1-1.7.2-2.1-3.8-3.2-3.8s-1.4 3.8-3.2 3.8-2.1-3.8-3.2-3.8-1.5 4-3.2 3.8c-2.3-.3-2.7-3.3-3.3-6.1-.7-3.1-2.1-4.7-2.9-7.2-1.3-3.9-.6-7.6 2.3-9Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
      <path d="M9 10.8h12M10.2 15h9.6M15 8.4v8.8" stroke="currentColor" strokeLinecap="round" strokeWidth="1" />
    </svg>
  );
}

function toothStateClass(state: ToothState) {
  if (isDiagnosticState(state) || state === "pathology") {
    return "border-rose-600/40 bg-rose-600/10 text-rose-300";
  }

  if (state === "in_progress") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  }

  if (isPerformedState(state) || state === "performed") {
    return "border-powder-blue-500/40 bg-powder-blue-950 text-powder-blue-500";
  }

  if (state === "missing") {
    return "border-dashed border-alabaster-grey-500/25 bg-black/10 text-alabaster-grey-500 opacity-45";
  }

  return "border-alabaster-grey-500/20 bg-glaucous-950 text-white hover:border-powder-blue-500/50";
}

function stateBadgeVariant(state: ToothState) {
  if (isDiagnosticState(state) || state === "pathology") {
    return "danger" as const;
  }

  if (state === "in_progress") {
    return "warning" as const;
  }

  if (isPerformedState(state) || state === "performed") {
    return "success" as const;
  }

  return "default" as const;
}

function toothStateKey(state: ToothState): L10nKey {
  if (state === "caries") {
    return "clinicalStateCaries";
  }

  if (state === "endodontics_needed") {
    return "clinicalStateEndodonticsNeeded";
  }

  if (state === "crown_needed") {
    return "clinicalStateCrownNeeded";
  }

  if (state === "extraction_needed") {
    return "clinicalStateExtractionNeeded";
  }

  if (state === "filling_done") {
    return "clinicalStateFillingDone";
  }

  if (state === "root_canal_done") {
    return "clinicalStateRootCanalDone";
  }

  if (state === "crown_done") {
    return "clinicalStateCrownDone";
  }

  if (state === "implant_done") {
    return "clinicalStateImplantDone";
  }

  if (state === "pathology") {
    return "clinicalStatePathology";
  }

  if (state === "in_progress") {
    return "clinicalStateInProgress";
  }

  if (state === "performed") {
    return "clinicalStatePerformed";
  }

  if (state === "missing") {
    return "clinicalStateMissing";
  }

  return "clinicalStateHealthy";
}

function isDiagnosticState(state: ToothState) {
  return diagnosisStates.includes(state);
}

function isPerformedState(state: ToothState) {
  return performedStates.includes(state);
}

function recordStatusKey(status: ClinicalRecordStatus): L10nKey {
  if (status === "in_quote") {
    return "clinicalStatusInQuote";
  }

  if (status === "performed") {
    return "clinicalStatusPerformed";
  }

  return "clinicalStatusDiagnosed";
}
