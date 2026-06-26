import { Check, Plus, Trash2, X } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  createClinicalRecord,
  deleteClinicalRecord,
  getToothStatuses,
  listClinicalRecords,
  listClinicalServices,
  type ClinicalRecord,
  type ClinicalService,
  type ToothStatus,
  type ToothState
} from "@/frontend/clinical/clinicalApi";
import { listRxAssets, rxAssetDataUrl, type RxAsset } from "@/frontend/patients/patientsApi";
import { useL10n, type L10nKey } from "@/frontend/shared/i18n/L10nProvider";
import { Button } from "@/frontend/shared/ui/button";
import { clinicalServiceGroupKey, clinicalServiceMatchesQuickAction } from "@/frontend/clinical/serviceCategories";
import { calculateBridgePreview } from "./bridge";

type ClinicalMobileMode = "clinical" | "orthodontics";
type ArchMode = "upper" | "lower";
type QuickAction = "diagnosis" | "hygiene" | "caries" | "endodontics" | "periodontics" | "crown" | "extraction" | "mobileProsthesis";

const upperTeeth = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const lowerTeeth = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

const quickActionButtonClasses: Record<QuickAction, string> = {
  diagnosis: "border-alabaster-grey-500/20 bg-glaucous-950 text-white hover:border-powder-blue-500/45 hover:bg-powder-blue-950",
  hygiene: "border-alabaster-grey-500/20 bg-glaucous-950 text-white hover:border-powder-blue-500/45 hover:bg-powder-blue-950",
  caries: "border-emerald-400/45 bg-emerald-400/12 text-emerald-100 hover:bg-emerald-400/20",
  endodontics: "border-violet-400/45 bg-violet-400/12 text-violet-100 hover:bg-violet-400/20",
  periodontics: "border-powder-blue-500/45 bg-powder-blue-500/12 text-powder-blue-100 hover:bg-powder-blue-500/20",
  crown: "border-amber-400/50 bg-amber-400/14 text-amber-100 hover:bg-amber-400/24",
  extraction: "border-red-500/50 bg-red-500/14 text-red-100 hover:bg-red-500/24",
  mobileProsthesis: "border-amber-300/45 bg-amber-300/10 text-amber-100 hover:bg-amber-300/20"
};

const recordedToothClasses: Record<QuickAction, string> = {
  diagnosis: "border-alabaster-grey-500/20 bg-ink-black-950 text-alabaster-grey-500",
  hygiene: "border-alabaster-grey-500/20 bg-ink-black-950 text-alabaster-grey-500",
  caries: "border-emerald-400/55 bg-emerald-400/18 text-white",
  endodontics: "border-violet-400/55 bg-violet-400/18 text-white",
  periodontics: "border-powder-blue-500/55 bg-powder-blue-500/18 text-white",
  crown: "border-amber-400/60 bg-amber-400/20 text-white",
  extraction: "border-red-500/60 bg-red-500/20 text-white",
  mobileProsthesis: "border-amber-300/55 bg-amber-300/16 text-white"
};

const toothStateClasses: Partial<Record<ToothState, string>> = {
  healthy: "border-alabaster-grey-500/20 bg-ink-black-950 text-alabaster-grey-500",
  in_progress: "border-powder-blue-500/35 bg-powder-blue-950 text-white",
  missing: "border-dashed border-alabaster-grey-500/20 bg-ink-black-950/40 text-alabaster-grey-500/45",
  pathology: "border-red-500/35 bg-red-500/10 text-white",
  performed: "border-emerald-400/35 bg-emerald-400/10 text-white"
};

interface MobileClinicalProps {
  activePatientId: number | null;
  assetMode?: "rx" | "photo" | null;
  diaryOpen?: boolean;
  mode: ClinicalMobileMode;
  onMissingPatient: () => void;
  onDiaryOpenChange?: (open: boolean) => void;
  onClinicalDiaryCountChange?: (count: number) => void;
  onSelectedToothRecordInfo: (info: SelectedToothRecordInfo | null) => void;
  sessionToken: string;
}

export interface SelectedToothRecordInfo {
  serviceName: string;
  toothNumber: number;
}

interface BridgeArcLayout {
  height: number;
  left: number;
  top: number;
  width: number;
}

interface RecordedToothRecord {
  action: QuickAction;
  recordId: number;
  serviceName: string;
}

interface ProsthesisGroup {
  key: string;
  teeth: number[];
}

export function MobileClinical({
  activePatientId,
  assetMode = null,
  diaryOpen = false,
  mode,
  onClinicalDiaryCountChange,
  onDiaryOpenChange,
  onMissingPatient,
  onSelectedToothRecordInfo,
  sessionToken
}: MobileClinicalProps) {
  const { t } = useL10n();
  const archRef = useRef<HTMLDivElement | null>(null);
  const toothRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const [services, setServices] = useState<ClinicalService[]>([]);
  const [arch, setArch] = useState<ArchMode>("upper");
  const [selectedTeeth, setSelectedTeeth] = useState<number[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [activeAction, setActiveAction] = useState<QuickAction | null>(null);
  const [bridgeLayouts, setBridgeLayouts] = useState<Partial<Record<string, BridgeArcLayout>>>({});
  const [clinicalRecords, setClinicalRecords] = useState<ClinicalRecord[]>([]);
  const [recordedToothRecords, setRecordedToothRecords] = useState<Partial<Record<number, RecordedToothRecord>>>({});
  const [toothStates, setToothStates] = useState<Partial<Record<number, ToothState>>>({});
  const [statusMessage, setStatusMessage] = useState("");
  const teeth = arch === "upper" ? upperTeeth : lowerTeeth;
  const bridgePreview = calculateBridgePreview(selectedTeeth);
  const prosthesisGroups = buildProsthesisGroups(recordedToothRecords, teeth);
  const bridgeGroups = prosthesisGroups.filter((group) => group.teeth.length >= 2);
  const singleProsthesisTeeth = new Set(
    prosthesisGroups.filter((group) => group.teeth.length === 1).map((group) => group.teeth[0])
  );
  const bridgeKey = bridgeGroups.map((group) => group.key).join("|");
  const selectedRecordIds = useMemo(
    () => clinicalRecords
      .filter((record) => record.tooth_number !== null && selectedTeeth.includes(record.tooth_number))
      .filter((record) => record.status === "diagnosed" || record.status === "in_quote" || record.status === "performed")
      .reduce<number[]>((ids, record) => ids.includes(record.id) ? ids : [...ids, record.id], []),
    [clinicalRecords, selectedTeeth]
  );

  async function refreshClinicalData() {
    if (!activePatientId || !sessionToken || services.length === 0) {
      setClinicalRecords([]);
      setRecordedToothRecords({});
      setToothStates({});
      return;
    }
    const [records, statuses] = await Promise.all([
      listClinicalRecords(sessionToken, activePatientId, {}),
      getToothStatuses(sessionToken, activePatientId)
    ]);
    const nextRecordedToothRecords = clinicalRecordsToToothRecords(records, services);
    setClinicalRecords(records);
    setRecordedToothRecords(nextRecordedToothRecords);
    setToothStates(normalizeToothStates(statuses, nextRecordedToothRecords));
  }

  useEffect(() => {
    if (!activePatientId) {
      onSelectedToothRecordInfo(null);
      onMissingPatient();
    }
  }, [activePatientId, onMissingPatient, onSelectedToothRecordInfo]);

  useEffect(() => {
    if (!sessionToken) {
      return;
    }
    void listClinicalServices(sessionToken)
      .then((items) => setServices(items.filter((service) => service.active)))
      .catch(() => setServices([]));
  }, [sessionToken]);

  useEffect(() => {
    if (!activePatientId || !sessionToken || services.length === 0) {
      setClinicalRecords([]);
      setRecordedToothRecords({});
      setToothStates({});
      return;
    }

    void refreshClinicalData()
      .catch(() => {
        setClinicalRecords([]);
        setRecordedToothRecords({});
        setToothStates({});
      });
  }, [activePatientId, services, sessionToken]);

  useEffect(() => {
    onClinicalDiaryCountChange?.(clinicalRecords.length);
  }, [clinicalRecords.length, onClinicalDiaryCountChange]);

  useEffect(() => {
    if (!activePatientId || !sessionToken || services.length === 0) {
      return;
    }
    const interval = window.setInterval(() => {
      void refreshClinicalData().catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(interval);
  }, [activePatientId, services, sessionToken]);

  useLayoutEffect(() => {
    if (bridgeGroups.length === 0 || !archRef.current) {
      setBridgeLayouts({});
      return;
    }

    function measureBridges() {
      if (!archRef.current) {
        return;
      }
      const containerRect = archRef.current.getBoundingClientRect();
      const layouts: Partial<Record<string, BridgeArcLayout>> = {};
      bridgeGroups.forEach((group) => {
        const rects = group.teeth
          .map((tooth) => toothRefs.current[tooth]?.getBoundingClientRect())
          .filter((rect): rect is DOMRect => Boolean(rect));

        if (rects.length < 2) {
          return;
        }

        const left = Math.min(...rects.map((rect) => rect.left)) - containerRect.left;
        const right = Math.max(...rects.map((rect) => rect.right)) - containerRect.left;
        const top = Math.max(2, Math.min(...rects.map((rect) => rect.top)) - containerRect.top - 13);

        layouts[group.key] = {
          height: 12,
          left,
          top,
          width: Math.max(48, right - left)
        };
      });
      setBridgeLayouts(layouts);
    }

    measureBridges();
    window.addEventListener("resize", measureBridges);
    return () => window.removeEventListener("resize", measureBridges);
  }, [arch, bridgeKey]);

  function handleToothPress(tooth: number) {
    if (!activePatientId) {
      return;
    }
    setActiveAction(null);
    const recorded = recordedToothRecords[tooth];
    onSelectedToothRecordInfo(recorded ? { serviceName: recorded.serviceName, toothNumber: tooth } : null);
    if (selectionMode) {
      setSelectedTeeth((current) => {
        if (current.includes(tooth)) {
          return current.filter((item) => item !== tooth);
        }
        return [...current, tooth];
      });
      return;
    }
    if (!selectionMode && selectedTeeth.length === 1 && selectedTeeth[0] === tooth) {
      setSelectedTeeth([]);
      onSelectedToothRecordInfo(null);
      return;
    }
    setSelectedTeeth([tooth]);
  }

  function handleQuickAction(action: QuickAction) {
    if (!activePatientId) {
      return;
    }
    setActiveAction(action);
  }

  async function handleServiceSelect(service: ClinicalService) {
    if (!activePatientId || !activeAction || !sessionToken) {
      return;
    }
    const targetTeeth = Array.from(
      new Set(
        activeAction === "crown" && bridgePreview
          ? bridgePreview.includedTeeth
          : selectedTeeth
      )
    );
    const isGeneralAction = activeAction === "diagnosis" || activeAction === "hygiene" || activeAction === "mobileProsthesis";
    if (targetTeeth.length === 0 && !isGeneralAction) {
      return;
    }

    const recordTargets = targetTeeth.length > 0 ? targetTeeth : [null];
    const records = await Promise.all(
      recordTargets.map((tooth) =>
        createClinicalRecord(sessionToken, {
          patient_id: activePatientId,
          service_id: service.id,
          tooth_number: tooth ?? undefined,
          pathology_description: service.name,
          status: "diagnosed",
          ready_for_quote: true
        })
      )
    );

    setRecordedToothRecords((current) => {
      const next = { ...current };
      records.forEach((record, index) => {
        const tooth = recordTargets[index];
        if (tooth === null) {
          return;
        }
        next[tooth] = { action: activeAction, recordId: record.id, serviceName: record.service_name ?? service.name };
      });
      return next;
    });
    setClinicalRecords((current) => [...records, ...current]);
    setStatusMessage(t("mobileClinicalServiceRegistered"));
    if (activeAction === "crown") {
      setSelectedTeeth(targetTeeth);
    } else {
      setSelectedTeeth([]);
    }
    setSelectionMode(false);
    setActiveAction(null);
    onSelectedToothRecordInfo(null);
  }

  async function handleClearSelection() {
    if (selectedRecordIds.length > 0) {
      await Promise.all(selectedRecordIds.map((recordId) => deleteClinicalRecord(sessionToken, recordId)));
      setRecordedToothRecords((current) => {
        const selectedSet = new Set(selectedTeeth);
        return Object.fromEntries(
          Object.entries(current).filter(([tooth]) => !selectedSet.has(Number(tooth)))
        );
      });
      setToothStates((current) => {
        const next = { ...current };
        selectedTeeth.forEach((tooth) => {
          next[tooth] = "healthy";
        });
        return next;
      });
      setClinicalRecords((current) => current.filter((record) => !selectedRecordIds.includes(record.id)));
      await refreshClinicalData();
    }
    setSelectedTeeth([]);
    setSelectionMode(false);
    setActiveAction(null);
    setStatusMessage("");
    onSelectedToothRecordInfo(null);
  }

  async function handleDeleteDiaryRecord(recordId: number) {
    if (!sessionToken) {
      return;
    }
    await deleteClinicalRecord(sessionToken, recordId);
    setSelectedTeeth([]);
    setSelectionMode(false);
    setActiveAction(null);
    onSelectedToothRecordInfo(null);
    await refreshClinicalData();
  }

  async function handleGeneralServiceSelect(service: ClinicalService) {
    if (!activePatientId || !sessionToken) {
      return;
    }
    const record = await createClinicalRecord(sessionToken, {
      patient_id: activePatientId,
      service_id: service.id,
      pathology_description: service.name,
      status: "diagnosed",
      ready_for_quote: true
    });
    setClinicalRecords((current) => [record, ...current]);
    setStatusMessage(t("mobileClinicalServiceRegistered"));
  }

  if (!activePatientId) {
    return (
      <section className="rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-4">
        <p className="text-sm leading-6 text-alabaster-grey-500">{t("mobileClinicalSelectPatientRedirect")}</p>
      </section>
    );
  }

  if (mode === "orthodontics") {
    return (
      <section className="grid gap-4">
        <MobileServicePanel
          title={t("mobileOrthodonticCatalog")}
          services={services.filter((service) => service.category?.toLowerCase().includes("ortodonz"))}
          onSelect={(service) => void handleGeneralServiceSelect(service).catch(() => setStatusMessage(t("mobileClinicalServiceError")))}
        />
        <div className="rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">
            {t("mobileOrthodonticRx")}
          </p>
          <div className="mt-3 grid gap-2">
            {[t("mobileTeleRx"), t("mobileCephalometric"), t("mobilePanoramicRx")].map((label) => (
              <Button key={label} type="button" variant="secondary" className="h-14 justify-start text-base">
                {label}
              </Button>
            ))}
          </div>
        </div>
        {statusMessage ? <p className="text-xs text-powder-blue-500">{statusMessage}</p> : null}
        {diaryOpen ? (
          <MobileClinicalDiaryModal
            records={clinicalRecords}
            onClose={() => onDiaryOpenChange?.(false)}
            onDelete={(recordId) => void handleDeleteDiaryRecord(recordId).catch(() => setStatusMessage(t("mobileClinicalServiceError")))}
          />
        ) : null}
      </section>
    );
  }

  if (assetMode) {
    return (
      <MobileClinicalAssetsViewer
        activePatientId={activePatientId}
        mode={assetMode}
        sessionToken={sessionToken}
      />
    );
  }

  return (
    <section className="grid gap-4">
      <div className="rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <p className="inline-flex min-h-14 items-center justify-center rounded-full border border-powder-blue-500/45 bg-powder-blue-500/15 px-4 py-1 text-center text-xs font-bold uppercase leading-tight tracking-widest text-powder-blue-100 shadow-[0_0_18px_rgba(56,142,216,0.18)]">
              {arch === "upper" ? t("mobileUpperArch") : t("mobileLowerArch")}
            </p>
            <Button
              type="button"
              variant="secondary"
              className="h-8 shrink-0 justify-center px-3 text-[11px]"
              onClick={() => {
                setArch((current) => (current === "upper" ? "lower" : "upper"));
                setSelectedTeeth([]);
                setSelectionMode(false);
                setActiveAction(null);
              }}
            >
              {arch === "upper" ? t("mobileLowerArch") : t("mobileUpperArch")}
            </Button>
          </div>
          {selectionMode ? (
            <span className="text-xs font-medium text-powder-blue-500">{t("mobileSelectionMode")}</span>
          ) : null}
        </div>
        <div ref={archRef} className="relative grid grid-cols-8 gap-2 overflow-visible pt-8">
          {bridgeGroups.map((group) => {
            const layout = bridgeLayouts[group.key];
            return layout ? <BridgeArc key={group.key} layout={layout} /> : null;
          })}
          {teeth.map((tooth) => {
            const selected = selectedTeeth.includes(tooth);
            const included = bridgeGroups.some((group) => group.teeth.includes(tooth));
            const recordedAction = recordedToothRecords[tooth]?.action;
            const toothState = toothStates[tooth];
            const singleProsthesis = singleProsthesisTeeth.has(tooth);
            return (
              <motion.button
                key={tooth}
                ref={(element) => {
                  toothRefs.current[tooth] = element;
                }}
                className={[
                  "relative z-20 flex h-14 flex-col items-center justify-center gap-0.5 rounded-md border text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-powder-blue-500/70",
                  recordedAction
                    ? recordedToothClasses[recordedAction]
                    : selected
                      ? "border-powder-blue-500 bg-powder-blue-950 text-white"
                      : included
                        ? "border-pale-sky-500/50 bg-pale-sky-950 text-white"
                        : toothState
                          ? toothStateClasses[toothState] ?? "border-alabaster-grey-500/20 bg-ink-black-950 text-alabaster-grey-500"
                          : "border-alabaster-grey-500/20 bg-ink-black-950 text-alabaster-grey-500"
                ].join(" ")}
                type="button"
                whileTap={{ scale: 0.94 }}
                onClick={() => handleToothPress(tooth)}
              >
                {singleProsthesis ? (
                  <span className="pointer-events-none absolute inset-1 rounded-full border-2 border-amber-400 shadow-[0_0_18px_rgba(251,191,36,0.5)]" />
                ) : null}
                {selected ? (
                  <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-powder-blue-500 text-white">
                    <Check aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                  </span>
                ) : null}
                <MobileToothGlyph toothNumber={tooth} />
                <span className="font-mono text-[10px]">{tooth}</span>
              </motion.button>
            );
          })}
        </div>
        {statusMessage ? <p className="mt-3 text-xs text-powder-blue-500">{statusMessage}</p> : null}
      </div>

      {selectedTeeth.length === 0 && !selectionMode ? (
        <GeneralQuickActions activeAction={activeAction} onAction={handleQuickAction} />
      ) : null}

      {selectedTeeth.length > 0 && !selectionMode ? (
        <QuickActions
          activeAction={activeAction}
          activePatientId={activePatientId}
          canClear={selectedRecordIds.length > 0}
          useBridge={selectedTeeth.length >= 2}
          onAction={handleQuickAction}
          onClear={() => void handleClearSelection().catch(() => setStatusMessage(t("mobileClinicalServiceError")))}
          onSelectionMode={() => setSelectionMode(true)}
        />
      ) : null}

      {activeAction ? (
        <MobileServiceOverlay
          services={services.filter((service) => clinicalServiceMatchesQuickAction(service.category, activeAction))}
          title={quickActionLabel(activeAction, selectedTeeth.length >= 2, t)}
          onClose={() => setActiveAction(null)}
          onSelect={(service) => void handleServiceSelect(service).catch(() => setStatusMessage(t("mobileClinicalServiceError")))}
        />
      ) : null}

      {selectionMode ? (
        <div
          className="sticky bottom-0 -mx-4 border-t border-alabaster-grey-500/20 bg-ink-black-950/95 px-4 py-3 backdrop-blur"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          <Button type="button" className="h-14 w-full justify-center text-base" onClick={() => setSelectionMode(false)}>
            {t("mobileFinishSelection")}
          </Button>
        </div>
      ) : null}
      {diaryOpen ? (
        <MobileClinicalDiaryModal
          records={clinicalRecords}
          onClose={() => onDiaryOpenChange?.(false)}
          onDelete={(recordId) => void handleDeleteDiaryRecord(recordId).catch(() => setStatusMessage(t("mobileClinicalServiceError")))}
        />
      ) : null}
    </section>
  );
}

function GeneralQuickActions({
  activeAction,
  onAction
}: {
  activeAction: QuickAction | null;
  onAction: (action: QuickAction) => void;
}) {
  const { t } = useL10n();
  const actions: { key: QuickAction; label: string }[] = [
    { key: "diagnosis", label: t("mobileDiagnosis") },
    { key: "hygiene", label: t("mobileHygiene") },
    { key: "mobileProsthesis", label: t("mobileRemovableProsthesis") }
  ];

  return (
    <div className="grid grid-cols-1 gap-2">
      {actions.map((action) => (
        <Button
          key={action.key}
          type="button"
          variant="secondary"
          className={[
            "h-14 justify-center text-sm",
            quickActionButtonClasses[action.key],
            activeAction === action.key ? "ring-2 ring-powder-blue-500/55" : ""
          ].join(" ")}
          onClick={() => onAction(action.key)}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}

function QuickActions({
  activeAction,
  activePatientId,
  canClear,
  useBridge,
  onAction,
  onClear,
  onSelectionMode
}: {
  activeAction: QuickAction | null;
  activePatientId: number;
  canClear: boolean;
  useBridge: boolean;
  onAction: (action: QuickAction) => void;
  onClear: () => void;
  onSelectionMode: () => void;
}) {
  const { t } = useL10n();
  const actions: { key: QuickAction; label: string }[] = [
    { key: "caries", label: t("mobileCaries") },
    { key: "endodontics", label: t("mobileEndodontics") },
    { key: "periodontics", label: t("mobileVarious") },
    { key: "crown", label: useBridge ? t("mobileBridge") : t("mobileCrown") },
    { key: "extraction", label: t("mobileExtraction") }
  ];

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-2">
        {canClear ? (
          <Button
            type="button"
            variant="secondary"
            className="h-14 justify-center border-red-500/45 text-red-300 hover:bg-red-500/15 hover:text-red-100"
            onClick={onClear}
          >
            <Trash2 aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
            {t("mobileClearTooth")}
          </Button>
        ) : null}
        <Button type="button" className="h-14 justify-center border-powder-blue-500/45 bg-powder-blue-950 text-white hover:bg-powder-blue-500/25" onClick={onSelectionMode}>
          <Plus aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
          {t("mobileAddToSelection")}
        </Button>
        {actions.map((action) => (
          <Button
            key={action.key}
            type="button"
            variant="secondary"
            className={[
              "h-14 justify-center text-sm",
              quickActionButtonClasses[action.key],
              activeAction === action.key ? "ring-2 ring-powder-blue-500/55" : ""
            ].join(" ")}
            onClick={() => {
              if (!activePatientId) {
                return;
              }
              onAction(action.key);
            }}
          >
            {action.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function MobileClinicalDiaryModal({
  onClose,
  onDelete,
  records
}: {
  onClose: () => void;
  onDelete: (recordId: number) => void;
  records: ClinicalRecord[];
}) {
  const { t } = useL10n();
  return (
    <div className="fixed inset-0 z-50 grid bg-ink-black-950/90 p-3 backdrop-blur-xl">
      <div
        className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="flex items-center justify-between border-b border-alabaster-grey-500/20 p-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">
              {t("clinicalDiaryTitle")}
            </p>
            <h2 className="text-base font-semibold text-white">{t("mobileClinicalTitle")}</h2>
          </div>
          <Button
            aria-label={t("mobileCloseMenu")}
            className="h-11 w-11 justify-center p-0"
            type="button"
            variant="secondary"
            onClick={onClose}
          >
            <X aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
          </Button>
        </div>
        <div className="min-h-0 overflow-y-auto p-3">
          {records.length ? (
            <div className="grid gap-2">
              {records.map((record) => (
                <article
                  key={record.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-xl border border-alabaster-grey-500/15 bg-ink-black-950 p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">
                      {record.service_name ?? record.pathology_description ?? t("clinicalNoService")}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-alabaster-grey-500">
                      {record.created_at} - {record.tooth_number ?? t("clinicalArch")} - {t(recordStatusKey(record.status))}
                    </p>
                  </div>
                  <Button
                    aria-label={t("clinicalDeleteRecord")}
                    className="h-10 w-10 justify-center border-red-500/35 p-0 text-red-300 hover:bg-red-500/15 hover:text-red-100"
                    type="button"
                    variant="secondary"
                    onClick={() => onDelete(record.id)}
                  >
                    <X aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
                  </Button>
                </article>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-alabaster-grey-500/20 bg-ink-black-950 p-4 text-sm text-alabaster-grey-500">
              {t("clinicalDiaryEmpty")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function MobileClinicalAssetsViewer({
  activePatientId,
  mode,
  sessionToken
}: {
  activePatientId: number | null;
  mode: "rx" | "photo";
  sessionToken: string;
}) {
  const { t } = useL10n();
  const [assets, setAssets] = useState<RxAsset[]>([]);
  const [previews, setPreviews] = useState<Record<number, string>>({});
  const [selectedSubType, setSelectedSubType] = useState<"ORTOPANTOMOGRAFIA" | "ENDORALE" | null>(null);
  const [viewer, setViewer] = useState<{ asset: RxAsset; dataUrl: string } | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  const rxSubTypes = useMemo(() => {
    const values = new Set(
      assets
        .filter((asset) => asset.sub_type !== "PHOTO" && asset.rx_type !== "photo")
        .map((asset) => asset.sub_type === "ENDORALE" || asset.rx_type === "endoral" ? "ENDORALE" : "ORTOPANTOMOGRAFIA")
    );
    return Array.from(values);
  }, [assets]);
  const visibleAssets = useMemo(() => {
    const filtered = assets.filter((asset) => mode === "photo" ? asset.sub_type === "PHOTO" || asset.rx_type === "photo" : asset.sub_type !== "PHOTO" && asset.rx_type !== "photo");
    return mode === "rx" && selectedSubType ? filtered.filter((asset) => asset.sub_type === selectedSubType || (selectedSubType === "ORTOPANTOMOGRAFIA" && asset.rx_type !== "endoral")) : filtered;
  }, [assets, mode, selectedSubType]);

  useEffect(() => {
    if (!activePatientId || !sessionToken) {
      setAssets([]);
      setPreviews({});
      return;
    }
    let cancelled = false;
    async function loadAssets() {
      const nextAssets = await listRxAssets(sessionToken, activePatientId ?? 0);
      if (cancelled) {
        return;
      }
      setAssets(nextAssets);
      const entries = await Promise.all(
        nextAssets
          .filter((asset) => asset.mime_type?.startsWith("image/"))
          .map(async (asset) => {
            const preview = await rxAssetDataUrl(sessionToken, asset.file_asset_id);
            return [asset.file_asset_id, preview.data_url] as const;
          })
      );
      if (!cancelled) {
        setPreviews(Object.fromEntries(entries));
      }
    }
    void loadAssets().catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("rxGenericError")));
    return () => {
      cancelled = true;
    };
  }, [activePatientId, sessionToken, t]);

  async function openAsset(asset: RxAsset) {
    if (!asset.mime_type?.startsWith("image/")) {
      setStatusMessage(t("rxDicomPreviewUnavailable"));
      return;
    }
    const dataUrl = previews[asset.file_asset_id] ?? (await rxAssetDataUrl(sessionToken, asset.file_asset_id)).data_url;
    setViewer({ asset, dataUrl });
  }

  return (
    <section className="grid gap-4">
      {mode === "rx" && rxSubTypes.length > 1 ? (
        <div className="grid grid-cols-2 gap-2">
          {(["ORTOPANTOMOGRAFIA", "ENDORALE"] as const).map((subType) => rxSubTypes.includes(subType) ? (
            <Button key={subType} type="button" variant={selectedSubType === subType ? "navActive" : "secondary"} className="h-14 justify-center" onClick={() => setSelectedSubType(subType)}>
              {t(rxSubTypeLabelKey(subType))}
            </Button>
          ) : null)}
        </div>
      ) : null}
      {statusMessage ? <p className="text-sm text-alabaster-grey-500">{statusMessage}</p> : null}
      {visibleAssets.length ? (
        <div className="grid grid-cols-2 gap-3">
          {visibleAssets.map((asset) => (
            <button key={asset.id} type="button" className="overflow-hidden rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 text-left" onClick={() => void openAsset(asset).catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("rxGenericError")))}>
              <div className="flex aspect-square items-center justify-center bg-ink-black-950">
                {previews[asset.file_asset_id] ? (
                  <img alt={t("rxThumbnailAlt")} className="h-full w-full object-cover" src={previews[asset.file_asset_id]} />
                ) : (
                  <span className="text-sm text-alabaster-grey-500">{t(rxSubTypeLabelKey(asset.sub_type))}</span>
                )}
              </div>
              <div className="grid gap-1 p-3">
                <span className="text-sm font-semibold text-white">{t(rxSubTypeLabelKey(asset.sub_type))}</span>
                <span className="text-xs text-alabaster-grey-500">{asset.acquired_at.slice(0, 10)}</span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-4 text-sm text-alabaster-grey-500">
          {mode === "rx" ? t("clinicalAssetRxEmpty") : t("clinicalAssetPhotoEmpty")}
        </p>
      )}
      {viewer ? (
        <div className="fixed inset-0 z-50 grid bg-ink-black-950/90 p-3 backdrop-blur-xl">
          <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950">
            <div className="flex items-center justify-between border-b border-alabaster-grey-500/20 p-3">
              <span className="text-sm font-semibold text-white">{t(rxSubTypeLabelKey(viewer.asset.sub_type))}</span>
              <Button type="button" variant="secondary" className="h-11 justify-center" onClick={() => setViewer(null)}>
                {t("rxViewerClose")}
              </Button>
            </div>
            <div className="flex min-h-0 items-center justify-center overflow-auto p-3">
              <img alt={t("rxViewerAlt")} className="max-h-full max-w-full rounded-md object-contain" src={viewer.dataUrl} />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function MobileServiceOverlay({
  onClose,
  onSelect,
  services,
  title
}: {
  onClose: () => void;
  onSelect: (service: ClinicalService) => void;
  services: ClinicalService[];
  title: string;
}) {
  const { t } = useL10n();
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 bg-black/45 px-4 pb-4 backdrop-blur-sm"
      style={{
        paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
        top: "calc(5.25rem + env(safe-area-inset-top))"
      }}
    >
      <div
        className="mx-auto mt-3 flex max-h-[calc(100dvh-7rem)] w-full max-w-[520px] flex-col rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">{title}</p>
          <Button type="button" variant="secondary" className="h-10 justify-center" onClick={onClose}>
            {t("mobileCloseMenu")}
          </Button>
        </div>
        <div className="grid min-h-0 gap-2 overflow-y-auto">
          {services.length ? (
            services.map((service) => (
              <Button
                key={service.id}
                type="button"
                variant="secondary"
                className="h-auto min-h-14 justify-start py-3 text-left"
                onClick={() => onSelect(service)}
              >
                {service.name}
              </Button>
            ))
          ) : (
            <p className="text-sm text-alabaster-grey-500">{t("mobileNoServices")}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function quickActionLabel(action: QuickAction, useBridge: boolean, t: ReturnType<typeof useL10n>["t"]) {
  if (action === "crown" && useBridge) {
    return t("mobileBridge");
  }
  const labels: Record<QuickAction, string> = {
    diagnosis: t("mobileDiagnosis"),
    caries: t("mobileCaries"),
    crown: t("mobileCrown"),
    endodontics: t("mobileEndodontics"),
    extraction: t("mobileExtraction"),
    hygiene: t("mobileHygiene"),
    mobileProsthesis: t("mobileRemovableProsthesis"),
    periodontics: t("mobileVarious")
  };
  return labels[action];
}

function recordStatusKey(status: ClinicalRecord["status"]): L10nKey {
  if (status === "in_quote") {
    return "clinicalStatusInQuote";
  }
  if (status === "performed") {
    return "clinicalStatusPerformed";
  }
  return "clinicalStatusDiagnosed";
}

function clinicalRecordsToToothRecords(
  records: ClinicalRecord[],
  services: ClinicalService[]
): Partial<Record<number, RecordedToothRecord>> {
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
  if (group === "diagnosis" || group === "hygiene") {
    return null;
  }
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

function rxSubTypeLabelKey(subType: string | null | undefined): L10nKey {
  if (subType === "PHOTO") {
    return "rxSubTypePhoto";
  }
  if (subType === "ENDORALE") {
    return "rxSubTypeEndorale";
  }
  return "rxSubTypeOrtopantomografia";
}

function buildProsthesisGroups(
  records: Partial<Record<number, RecordedToothRecord>>,
  visibleTeeth: number[]
): ProsthesisGroup[] {
  const prosthesisTeeth = visibleTeeth
    .filter((tooth) => records[tooth]?.action === "crown")
    .sort((left, right) => left - right);
  const groups: number[][] = [];
  prosthesisTeeth.forEach((tooth) => {
    const previousGroup = groups.at(-1);
    const previousTooth = previousGroup?.at(-1);
    if (previousGroup && previousTooth && Math.floor(previousTooth / 10) === Math.floor(tooth / 10) && tooth === previousTooth + 1) {
      previousGroup.push(tooth);
      return;
    }
    groups.push([tooth]);
  });
  return groups.map((teethGroup) => ({
    key: teethGroup.join("-"),
    teeth: teethGroup
  }));
}

function MobileServicePanel({
  onSelect,
  services,
  title
}: {
  onSelect?: (service: ClinicalService) => void;
  services: ClinicalService[];
  title: string;
}) {
  const { t } = useL10n();
  return (
    <div className="rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">{title}</p>
      <div className="mt-3 grid gap-2">
        {services.length ? (
          services.slice(0, 8).map((service) => (
            <Button
              key={service.id}
              type="button"
              variant="secondary"
              className="h-auto min-h-14 justify-start py-3 text-left"
              onClick={() => onSelect?.(service)}
            >
              {service.name}
            </Button>
          ))
        ) : (
          <p className="text-sm text-alabaster-grey-500">{t("mobileNoServices")}</p>
        )}
      </div>
    </div>
  );
}

function MobileToothGlyph({ toothNumber }: { toothNumber: number }) {
  const position = toothNumber % 10;
  const commonClass = "h-6 w-6 text-current";
  if (position <= 2) {
    return (
      <svg aria-hidden="true" className={commonClass} fill="none" viewBox="0 0 24 30">
        <path d="M8 3.8c1.2-.8 2.6-.8 4-.2 1.4-.6 2.8-.6 4 .2 1.8 1.2 2.3 4.2 1.2 7.1-.8 2.1-1.2 4.4-1.4 7.2-.3 4.5-1.4 7.5-3.8 7.5s-3.5-3-3.8-7.5c-.2-2.8-.6-5.1-1.4-7.2-1.1-2.9-.6-5.9 1.2-7.1Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
        <path d="M9 10.2h6" stroke="currentColor" strokeLinecap="round" strokeWidth="1" />
      </svg>
    );
  }
  if (position === 3) {
    return (
      <svg aria-hidden="true" className={commonClass} fill="none" viewBox="0 0 24 30">
        <path d="M7.2 3.5c1.5-1 3.2-.3 4.8-.3s3.3-.7 4.8.3c2 1.4 2.2 4.8.9 7.9-.9 2.1-1.7 4.9-2.3 8.4-.6 3.8-1.5 6.1-3.4 6.1s-2.8-2.3-3.4-6.1c-.6-3.5-1.4-6.3-2.3-8.4-1.3-3.1-1.1-6.5.9-7.9Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
        <path d="M12 12.5v9" stroke="currentColor" strokeLinecap="round" strokeWidth="1" />
      </svg>
    );
  }
  if (position <= 5) {
    return (
      <svg aria-hidden="true" className={commonClass} fill="none" viewBox="0 0 26 30">
        <path d="M6.5 3.4c1.8-.9 3.9.1 6.5.1s4.7-1 6.5-.1c2.6 1.3 3.2 4.8 2.1 8.4-.7 2.3-1.9 4.1-2.5 7.2-.5 2.8-.9 6-3 6.4-1.7.3-2-3.8-3.1-3.8s-1.4 4.1-3.1 3.8c-2.1-.4-2.5-3.6-3-6.4-.6-3.1-1.8-4.9-2.5-7.2-1.1-3.6-.5-7.1 2.1-8.4Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
        <path d="M9.2 10.2h7.6M10 14.4h6" stroke="currentColor" strokeLinecap="round" strokeWidth="1" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" className={commonClass} fill="none" viewBox="0 0 30 30">
      <path d="M6.3 3.5c2.1-1 4.1.2 6.1.2 1.1 0 1.7-.5 2.6-.5s1.5.5 2.6.5c2 0 4-1.2 6.1-.2 2.9 1.4 3.6 5.1 2.3 9-.8 2.5-2.2 4.1-2.9 7.2-.6 2.8-1 5.8-3.3 6.1-1.7.2-2.1-3.8-3.2-3.8s-1.4 3.8-3.2 3.8-2.1-3.8-3.2-3.8-1.5 4-3.2 3.8c-2.3-.3-2.7-3.3-3.3-6.1-.7-3.1-2.1-4.7-2.9-7.2-1.3-3.9-.6-7.6 2.3-9Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
      <path d="M9 10.8h12M10.2 15h9.6M15 8.4v8.8" stroke="currentColor" strokeLinecap="round" strokeWidth="1" />
    </svg>
  );
}

function BridgeArc({ layout }: { layout: BridgeArcLayout }) {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute z-10 text-amber-400 drop-shadow-[0_0_10px_rgba(251,191,36,0.45)]"
      style={{
        height: layout.height,
        left: layout.left,
        top: layout.top,
        width: layout.width
      }}
      viewBox="0 0 100 12"
      preserveAspectRatio="none"
    >
      <path
        d="M4 6 L96 6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="4"
      />
    </svg>
  );
}
