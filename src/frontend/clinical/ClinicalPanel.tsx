import { Check, ListFilter, Plus, Stethoscope, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/frontend/shared/ui/badge";
import { Button } from "@/frontend/shared/ui/button";
import { Input } from "@/frontend/shared/ui/input";
import { useL10n, type L10nKey } from "@/frontend/shared/i18n/L10nProvider";
import type { Patient } from "@/frontend/patients/patientsApi";
import type { User } from "@/frontend/settings/settingsApi";
import { calculateBridgePreview } from "@/frontend/mobile/bridge";
import { clinicalServiceGroupKey, clinicalServiceMatchesQuickAction } from "@/frontend/clinical/serviceCategories";
import {
  createClinicalRecord,
  deleteClinicalRecord,
  getToothStatuses,
  listClinicalRecords,
  listClinicalServices,
  markClinicalRecordReadyForQuote,
  openClinicalView,
  type ClinicalRecord,
  type ClinicalRecordStatus,
  type ClinicalService,
  type ToothStatus,
  type ToothState
} from "./clinicalApi";

interface ClinicalPanelProps {
  currentUser: User | null;
  patient: Patient;
}

type QuickAction = "caries" | "endodontics" | "periodontics" | "crown" | "extraction" | "mobileProsthesis";

interface RecordedToothRecord {
  action: QuickAction;
  recordId: number;
  serviceName: string;
}

interface ProsthesisGroup {
  key: string;
  startIndex: number;
  endIndex: number;
  teeth: number[];
}

const upperTeeth = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const lowerTeeth = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

const quickActionButtonClasses: Record<QuickAction, string> = {
  caries: "border-emerald-400/45 bg-emerald-400/12 text-emerald-100 hover:bg-emerald-400/20",
  crown: "border-amber-400/50 bg-amber-400/14 text-amber-100 hover:bg-amber-400/24",
  endodontics: "border-violet-400/45 bg-violet-400/12 text-violet-100 hover:bg-violet-400/20",
  extraction: "border-red-500/50 bg-red-500/14 text-red-100 hover:bg-red-500/24",
  mobileProsthesis: "border-amber-300/45 bg-amber-300/10 text-amber-100 hover:bg-amber-300/20",
  periodontics: "border-powder-blue-500/45 bg-powder-blue-500/12 text-powder-blue-100 hover:bg-powder-blue-500/20"
};

const recordedToothClasses: Record<QuickAction, string> = {
  caries: "border-emerald-400/55 bg-emerald-400/18 text-white",
  crown: "border-amber-400/60 bg-amber-400/20 text-white",
  endodontics: "border-violet-400/55 bg-violet-400/18 text-white",
  extraction: "border-red-500/60 bg-red-500/20 text-white",
  mobileProsthesis: "border-amber-300/55 bg-amber-300/16 text-white",
  periodontics: "border-powder-blue-500/55 bg-powder-blue-500/18 text-white"
};

const recordedToothGlyphClasses: Record<QuickAction, string> = {
  caries: "text-emerald-200",
  crown: "text-amber-200",
  endodontics: "text-violet-200",
  extraction: "text-red-200",
  mobileProsthesis: "text-amber-100",
  periodontics: "text-powder-blue-100"
};

const toothStateClasses: Partial<Record<ToothState, string>> = {
  healthy: "border-alabaster-grey-500/20 bg-ink-black-950 text-alabaster-grey-500",
  in_progress: "border-powder-blue-500/35 bg-powder-blue-950 text-white",
  missing: "border-dashed border-alabaster-grey-500/20 bg-ink-black-950/40 text-alabaster-grey-500/45",
  pathology: "border-red-500/35 bg-red-500/10 text-white",
  performed: "border-emerald-400/35 bg-emerald-400/10 text-white"
};

export function ClinicalPanel({ currentUser, patient }: ClinicalPanelProps) {
  const { t } = useL10n();
  const [services, setServices] = useState<ClinicalService[]>([]);
  const [records, setRecords] = useState<ClinicalRecord[]>([]);
  const [allRecords, setAllRecords] = useState<ClinicalRecord[]>([]);
  const [toothStates, setToothStates] = useState<Partial<Record<number, ToothState>>>({});
  const [recordedToothRecords, setRecordedToothRecords] = useState<Partial<Record<number, RecordedToothRecord>>>({});
  const [selectedTeeth, setSelectedTeeth] = useState<number[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [activeAction, setActiveAction] = useState<QuickAction | null>(null);
  const [filters, setFilters] = useState({ dateFrom: "", dateTo: "", toothNumber: "", operatorUserId: "" });
  const [statusMessage, setStatusMessage] = useState("");
  const [auditedPatientId, setAuditedPatientId] = useState<number | null>(null);
  const bridgePreview = calculateBridgePreview(selectedTeeth);

  const activeServices = useMemo(() => services.filter((service) => service.active), [services]);
  const visibleServices = activeAction
    ? activeServices.filter((service) => clinicalServiceMatchesQuickAction(service.category, activeAction))
    : [];
  const selectedToothRecordInfo = selectedTeeth.length === 1
    ? recordedToothRecords[selectedTeeth[0]]
    : null;
  const selectedRecordIds = useMemo(
    () => allRecords
      .filter((record) => record.tooth_number !== null && selectedTeeth.includes(record.tooth_number))
      .filter((record) => record.status === "diagnosed" || record.status === "in_quote" || record.status === "performed")
      .reduce<number[]>((ids, record) => ids.includes(record.id) ? ids : [...ids, record.id], []),
    [allRecords, selectedTeeth]
  );

  async function refreshClinicalData() {
    if (!currentUser?.session_token) {
      return;
    }

    const [nextServices, nextStatuses, nextAllRecords, nextRecords] = await Promise.all([
      listClinicalServices(currentUser.session_token),
      getToothStatuses(currentUser.session_token, patient.id),
      listClinicalRecords(currentUser.session_token, patient.id, {}),
      listClinicalRecords(currentUser.session_token, patient.id, {
        date_from: filters.dateFrom || undefined,
        date_to: filters.dateTo || undefined,
        operator_user_id: filters.operatorUserId ? Number(filters.operatorUserId) : undefined,
        tooth_number: filters.toothNumber ? Number(filters.toothNumber) : undefined
      })
    ]);

    setServices(nextServices);
    setRecords(nextRecords);
    setAllRecords(nextAllRecords);
    const nextRecordedToothRecords = clinicalRecordsToToothRecords(nextAllRecords, nextServices);
    setRecordedToothRecords(nextRecordedToothRecords);
    setToothStates(normalizeToothStates(nextStatuses, nextRecordedToothRecords));
  }

  useEffect(() => {
    if (!currentUser?.session_token) {
      return;
    }
    const sessionToken = currentUser.session_token;

    async function openAndRefresh() {
      if (auditedPatientId !== patient.id) {
        await openClinicalView(sessionToken, patient.id);
        setAuditedPatientId(patient.id);
      }
      await refreshClinicalData();
    }

    void openAndRefresh().catch((error: unknown) => {
      setStatusMessage(error instanceof Error ? error.message : t("clinicalGenericError"));
    });
  }, [currentUser?.id, currentUser?.session_token, patient.id, auditedPatientId]);

  useEffect(() => {
    if (!currentUser?.session_token) {
      return;
    }
    const interval = window.setInterval(() => {
      void refreshClinicalData().catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(interval);
  }, [currentUser?.session_token, patient.id, filters.dateFrom, filters.dateTo, filters.operatorUserId, filters.toothNumber]);

  if (!currentUser?.session_token) {
    return <p className="text-sm text-alabaster-grey-500">{t("clinicalLoginRequired")}</p>;
  }
  const sessionToken = currentUser.session_token;

  function handleToothPress(tooth: number) {
    setActiveAction(null);
    if (selectionMode) {
      setSelectedTeeth((current) => current.includes(tooth) ? current.filter((item) => item !== tooth) : [...current, tooth]);
      return;
    }
    setSelectedTeeth([tooth]);
  }

  async function handleServiceSelect(service: ClinicalService) {
    if (!activeAction) {
      return;
    }

    const targetTeeth = Array.from(new Set(activeAction === "crown" && bridgePreview ? bridgePreview.includedTeeth : selectedTeeth));
    if (targetTeeth.length === 0) {
      return;
    }

    await Promise.all(
      targetTeeth.map((tooth) =>
        createClinicalRecord(sessionToken, {
          patient_id: patient.id,
          pathology_description: service.name,
          ready_for_quote: true,
          service_id: service.id,
          status: "diagnosed",
          tooth_number: tooth
        })
      )
    );

    setStatusMessage(t("clinicalRecordCreated"));
    setSelectedTeeth(activeAction === "crown" ? targetTeeth : []);
    setSelectionMode(false);
    setActiveAction(null);
    await refreshClinicalData();
  }

  async function handleClearSelection() {
    await Promise.all(selectedRecordIds.map((recordId) => deleteClinicalRecord(sessionToken, recordId)));
    setSelectedTeeth([]);
    setSelectionMode(false);
    setActiveAction(null);
    setStatusMessage(t("mobileClearTooth"));
    await refreshClinicalData();
  }

  async function handleToggleQuote(record: ClinicalRecord) {
    const updated = await markClinicalRecordReadyForQuote(sessionToken, record.id, !record.ready_for_quote);
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
          {(["caries", "endodontics", "periodontics", "crown", "extraction"] as QuickAction[]).map((action) => (
            <span key={action} className={`rounded-md border px-2 py-1 text-xs ${quickActionButtonClasses[action]}`}>
              {quickActionLabel(action, false, t)}
            </span>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-md border border-alabaster-grey-500/20 bg-ink-black-950 p-4">
          <OdontogramRow
            recordedToothRecords={recordedToothRecords}
            selectedTeeth={selectedTeeth}
            teeth={upperTeeth}
            toothStates={toothStates}
            onSelect={handleToothPress}
          />
          <div className="my-4 h-px bg-alabaster-grey-500/20" />
          <OdontogramRow
            recordedToothRecords={recordedToothRecords}
            selectedTeeth={selectedTeeth}
            teeth={lowerTeeth}
            toothStates={toothStates}
            onSelect={handleToothPress}
          />
          {statusMessage ? <p className="mt-3 text-xs text-powder-blue-500">{statusMessage}</p> : null}
        </section>

        <aside className="rounded-md border border-alabaster-grey-500/20 bg-ink-black-950 p-4">
          <div className="flex items-center gap-2">
            <Stethoscope aria-hidden="true" className="h-4 w-4 text-powder-blue-500" strokeWidth={1.5} />
            <h4 className="text-sm font-semibold text-white">{t("clinicalQuickMenuTitle")}</h4>
          </div>
          <p className="mt-2 font-mono text-xs text-alabaster-grey-500">
            {selectedTeeth.length ? `${t("clinicalSelectedTooth")}: ${selectedTeeth.join(", ")}` : t("clinicalSelectTooth")}
          </p>
          {selectedToothRecordInfo ? (
            <div className="mt-3 rounded-md border border-powder-blue-500/25 bg-powder-blue-950/60 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">
                {t("mobileRecordedTooth")}
              </p>
              <p className="mt-1 text-sm font-semibold text-white">{selectedToothRecordInfo.serviceName}</p>
            </div>
          ) : null}
          {selectionMode ? <p className="mt-2 text-xs text-powder-blue-500">{t("mobileSelectionMode")}</p> : null}
          {selectedTeeth.length ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button type="button" className="h-12 justify-center border-powder-blue-500/45 bg-powder-blue-950 text-white hover:bg-powder-blue-500/25" onClick={() => setSelectionMode(true)}>
                <Plus aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
                {t("mobileAddToSelection")}
              </Button>
              {(["caries", "endodontics", "periodontics", "crown", "extraction", "mobileProsthesis"] as QuickAction[]).map((action) => (
                <Button
                  key={action}
                  type="button"
                  variant="secondary"
                  className={`h-12 justify-center ${quickActionButtonClasses[action]} ${activeAction === action ? "ring-2 ring-powder-blue-500/55" : ""}`}
                  onClick={() => setActiveAction(action)}
                >
                  {quickActionLabel(action, selectedTeeth.length >= 2, t)}
                </Button>
              ))}
              {selectedRecordIds.length > 0 ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="col-span-2 h-12 justify-center border-red-500/45 text-red-300 hover:bg-red-500/15 hover:text-red-100"
                  onClick={() => void handleClearSelection().catch(() => setStatusMessage(t("clinicalGenericError")))}
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
                  {t("mobileClearTooth")}
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-alabaster-grey-500">{t("mobileClinicalNoDataInstruction")}</p>
          )}

          {selectionMode ? (
            <Button type="button" className="mt-3 h-12 w-full justify-center" onClick={() => setSelectionMode(false)}>
              {t("mobileFinishSelection")}
            </Button>
          ) : null}

          {activeAction ? (
            <div className="mt-4 rounded-md border border-alabaster-grey-500/20 bg-glaucous-950 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">
                  {quickActionLabel(activeAction, selectedTeeth.length >= 2, t)}
                </p>
                <Button type="button" variant="secondary" className="h-8 justify-center px-3 text-xs" onClick={() => setActiveAction(null)}>
                  {t("mobileCloseMenu")}
                </Button>
              </div>
              <div className="grid max-h-[380px] gap-2 overflow-y-auto">
                {visibleServices.length ? (
                  visibleServices.map((service) => (
                    <Button key={service.id} type="button" variant="secondary" className="h-auto min-h-12 justify-start py-2 text-left" onClick={() => void handleServiceSelect(service).catch(() => setStatusMessage(t("clinicalGenericError")))}>
                      {service.name}
                    </Button>
                  ))
                ) : (
                  <p className="text-sm text-alabaster-grey-500">{t("mobileNoServices")}</p>
                )}
              </div>
            </div>
          ) : null}
        </aside>
      </div>

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
          <Button type="button" variant="secondary" onClick={() => void refreshClinicalData()}>
            {t("clinicalApplyFilters")}
          </Button>
        </div>
        <ClinicalDiary records={records} onToggleQuote={(record) => void handleToggleQuote(record)} />
      </section>
    </div>
  );
}

function OdontogramRow({
  onSelect,
  recordedToothRecords,
  selectedTeeth,
  teeth,
  toothStates
}: {
  onSelect: (toothNumber: number) => void;
  recordedToothRecords: Partial<Record<number, RecordedToothRecord>>;
  selectedTeeth: number[];
  teeth: number[];
  toothStates: Partial<Record<number, ToothState>>;
}) {
  const { t } = useL10n();
  const groups = buildProsthesisGroups(recordedToothRecords, teeth);
  const bridgeGroups = groups.filter((group) => group.teeth.length >= 2);
  const singleProsthesisTeeth = new Set(groups.filter((group) => group.teeth.length === 1).map((group) => group.teeth[0]));

  return (
    <div className="relative grid [grid-template-columns:repeat(16,minmax(0,1fr))] gap-2 overflow-visible pt-6">
      {bridgeGroups.map((group) => (
        <span
          key={group.key}
          aria-hidden="true"
          className="pointer-events-none absolute top-2 z-10 h-1 rounded-full bg-amber-400 shadow-[0_0_14px_rgba(251,191,36,0.55)]"
          style={{
            left: formatPercent(((group.startIndex + 0.16) / teeth.length) * 100),
            width: formatPercent(((group.endIndex - group.startIndex + 0.68) / teeth.length) * 100)
          }}
        />
      ))}
      {teeth.map((toothNumber) => {
        const selected = selectedTeeth.includes(toothNumber);
        const recordedAction = recordedToothRecords[toothNumber]?.action;
        const toothState = toothStates[toothNumber];
        const singleProsthesis = singleProsthesisTeeth.has(toothNumber);
        return (
          <motion.button
            key={toothNumber}
            aria-label={`${t("clinicalToothNumber")} ${String(toothNumber)}`}
            className={[
              "relative z-20 flex min-h-20 flex-col items-center justify-center gap-1 rounded-md border px-1 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-powder-blue-500/70",
              recordedAction
                ? recordedToothClasses[recordedAction]
                : selected
                  ? "border-powder-blue-500 bg-powder-blue-950 text-white"
                  : toothState
                    ? toothStateClasses[toothState] ?? "border-alabaster-grey-500/20 bg-ink-black-950 text-alabaster-grey-500"
                    : "border-alabaster-grey-500/20 bg-glaucous-950 text-alabaster-grey-500 hover:border-powder-blue-500/50 hover:text-powder-blue-100"
            ].join(" ")}
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={() => onSelect(toothNumber)}
          >
            {singleProsthesis ? <span className="pointer-events-none absolute inset-2 rounded-full border-2 border-amber-400 shadow-[0_0_18px_rgba(251,191,36,0.5)]" /> : null}
            {selected ? (
              <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-powder-blue-500 text-white">
                <Check aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
              </span>
            ) : null}
            <ToothGlyph
              className={recordedAction ? recordedToothGlyphClasses[recordedAction] : undefined}
              toothNumber={toothNumber}
              state={recordedAction ? "healthy" : toothState ?? "healthy"}
            />
            <span className="font-mono text-[11px] font-semibold">{toothNumber}</span>
          </motion.button>
        );
      })}
    </div>
  );
}

function ClinicalDiary({ onToggleQuote, records }: { onToggleQuote: (record: ClinicalRecord) => void; records: ClinicalRecord[] }) {
  const { t } = useL10n();
  return (
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
                    <Button type="button" variant={record.ready_for_quote ? "navActive" : "secondary"} size="sm" onClick={() => onToggleQuote(record)}>
                      {record.ready_for_quote ? t("clinicalQuoteReady") : t("clinicalQuoteMark")}
                    </Button>
                  ) : (
                    <Badge variant="default">{t(quoteEligibilityStatusKey(record.status))}</Badge>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function clinicalRecordsToToothRecords(records: ClinicalRecord[], services: ClinicalService[]): Partial<Record<number, RecordedToothRecord>> {
  const serviceCategoryById = new Map(services.map((service) => [service.id, service.category?.toLowerCase() ?? ""]));
  const next: Partial<Record<number, RecordedToothRecord>> = {};
  records.forEach((record) => {
    if (!record.tooth_number || next[record.tooth_number]) {
      return;
    }
    const category = record.service_id ? serviceCategoryById.get(record.service_id) ?? "" : "";
    const action = quickActionFromCategory(category);
    if (!action) {
      return;
    }
    next[record.tooth_number] = {
      action,
      recordId: record.id,
      serviceName: record.service_name ?? record.pathology_description ?? ""
    };
  });
  return next;
}

function normalizeToothStates(
  statuses: ToothStatus[],
  recordedRecords: Partial<Record<number, RecordedToothRecord>>
): Partial<Record<number, ToothState>> {
  return Object.fromEntries(
    statuses.map((status) => [
      status.tooth_number,
      recordedRecords[status.tooth_number] || status.state === "missing" ? status.state : "healthy"
    ])
  );
}

function quickActionFromCategory(category: string | null): QuickAction | null {
  const value = category?.trim().toLowerCase() ?? "";
  const group = clinicalServiceGroupKey(category);
  if (group === "conservative") {
    return "caries";
  }
  if (group === "endodontics") {
    return "endodontics";
  }
  if (group === "prosthesis" && value.includes("protesi mobile")) {
    return "mobileProsthesis";
  }
  if (group === "prosthesis") {
    return "crown";
  }
  if (group === "surgery") {
    return "extraction";
  }
  if (group === "various") {
    return "periodontics";
  }
  return null;
}

function quoteEligibilityStatusKey(status: ClinicalRecordStatus): L10nKey {
  if (status === "in_quote") {
    return "clinicalQuoteAlreadyInQuote";
  }
  if (status === "performed") {
    return "clinicalQuotePerformed";
  }
  return "clinicalQuoteNotEligible";
}

function buildProsthesisGroups(records: Partial<Record<number, RecordedToothRecord>>, visibleTeeth: number[]): ProsthesisGroup[] {
  const prosthesisIndexes = visibleTeeth
    .map((tooth, index) => ({ index, tooth }))
    .filter((entry) => records[entry.tooth]?.action === "crown");
  const groups: { endIndex: number; startIndex: number; teeth: number[] }[] = [];
  prosthesisIndexes.forEach((entry) => {
    const previous = groups.at(-1);
    if (previous && entry.index === previous.endIndex + 1) {
      previous.endIndex = entry.index;
      previous.teeth.push(entry.tooth);
      return;
    }
    groups.push({ endIndex: entry.index, startIndex: entry.index, teeth: [entry.tooth] });
  });
  return groups.map((group) => ({ ...group, key: group.teeth.join("-") }));
}

function formatPercent(value: number) {
  return `${value.toFixed(4)}%`;
}

function quickActionLabel(action: QuickAction, useBridge: boolean, t: (key: L10nKey) => string) {
  if (action === "crown" && useBridge) {
    return t("mobileBridge");
  }
  const labels: Record<QuickAction, string> = {
    caries: t("mobileCaries"),
    crown: t("mobileCrown"),
    endodontics: t("mobileEndodontics"),
    extraction: t("mobileExtraction"),
    mobileProsthesis: t("mobileRemovableProsthesis"),
    periodontics: t("mobileVarious")
  };
  return labels[action];
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

function ToothGlyph({ className = "", state, toothNumber }: { className?: string; state: ToothState; toothNumber: number }) {
  const position = toothNumber % 10;
  const missingClass = state === "missing" ? "opacity-10" : "";
  const classes = [className, missingClass].filter(Boolean).join(" ");

  if (position <= 2) {
    return (
      <svg aria-hidden="true" className={`h-8 w-6 ${classes}`} fill="none" viewBox="0 0 24 30">
        <path d="M8 3.8c1.2-.8 2.6-.8 4-.2 1.4-.6 2.8-.6 4 .2 1.8 1.2 2.3 4.2 1.2 7.1-.8 2.1-1.2 4.4-1.4 7.2-.3 4.5-1.4 7.5-3.8 7.5s-3.5-3-3.8-7.5c-.2-2.8-.6-5.1-1.4-7.2-1.1-2.9-.6-5.9 1.2-7.1Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
        <path d="M9 10.2h6" stroke="currentColor" strokeLinecap="round" strokeWidth="1" />
      </svg>
    );
  }

  if (position === 3) {
    return (
      <svg aria-hidden="true" className={`h-8 w-6 ${classes}`} fill="none" viewBox="0 0 24 30">
        <path d="M7.2 3.5c1.5-1 3.2-.3 4.8-.3s3.3-.7 4.8.3c2 1.4 2.2 4.8.9 7.9-.9 2.1-1.7 4.9-2.3 8.4-.6 3.8-1.5 6.1-3.4 6.1s-2.8-2.3-3.4-6.1c-.6-3.5-1.4-6.3-2.3-8.4-1.3-3.1-1.1-6.5.9-7.9Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
        <path d="M12 12.5v9" stroke="currentColor" strokeLinecap="round" strokeWidth="1" />
      </svg>
    );
  }

  if (position <= 5) {
    return (
      <svg aria-hidden="true" className={`h-8 w-7 ${classes}`} fill="none" viewBox="0 0 26 30">
        <path d="M6.5 3.4c1.8-.9 3.9.1 6.5.1s4.7-1 6.5-.1c2.6 1.3 3.2 4.8 2.1 8.4-.7 2.3-1.9 4.1-2.5 7.2-.5 2.8-.9 6-3 6.4-1.7.3-2-3.8-3.1-3.8s-1.4 4.1-3.1 3.8c-2.1-.4-2.5-3.6-3-6.4-.6-3.1-1.8-4.9-2.5-7.2-1.1-3.6-.5-7.1 2.1-8.4Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
        <path d="M9.2 10.2h7.6M10 14.4h6" stroke="currentColor" strokeLinecap="round" strokeWidth="1" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className={`h-8 w-8 ${classes}`} fill="none" viewBox="0 0 30 30">
      <path d="M6.3 3.5c2.1-1 4.1.2 6.1.2 1.1 0 1.7-.5 2.6-.5s1.5.5 2.6.5c2 0 4-1.2 6.1-.2 2.9 1.4 3.6 5.1 2.3 9-.8 2.5-2.2 4.1-2.9 7.2-.6 2.8-1 5.8-3.3 6.1-1.7.2-2.1-3.8-3.2-3.8s-1.4 3.8-3.2 3.8-2.1-3.8-3.2-3.8-1.5 4-3.2 3.8c-2.3-.3-2.7-3.3-3.3-6.1-.7-3.1-2.1-4.7-2.9-7.2-1.3-3.9-.6-7.6 2.3-9Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
      <path d="M9 10.8h12M10.2 15h9.6M15 8.4v8.8" stroke="currentColor" strokeLinecap="round" strokeWidth="1" />
    </svg>
  );
}
