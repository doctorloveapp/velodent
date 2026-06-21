import { Check, Plus } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createClinicalRecord, listClinicalServices, type ClinicalService } from "@/frontend/clinical/clinicalApi";
import { useL10n } from "@/frontend/shared/i18n/L10nProvider";
import { Button } from "@/frontend/shared/ui/button";
import { calculateBridgePreview } from "./bridge";

type ClinicalMobileMode = "clinical" | "orthodontics";
type ArchMode = "upper" | "lower";
type QuickAction = "caries" | "endodontics" | "periodontics" | "crown" | "extraction" | "mobileProsthesis";

const upperTeeth = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const lowerTeeth = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

const quickActionCategories: Record<QuickAction, string> = {
  caries: "conservativa",
  endodontics: "endodonzia",
  periodontics: "chirurgia parodontale",
  crown: "protesi fissa",
  extraction: "chirurgia orale",
  mobileProsthesis: "protesi mobile"
};

interface MobileClinicalProps {
  activePatientId: number | null;
  mode: ClinicalMobileMode;
  onMissingPatient: () => void;
  sessionToken: string;
}

interface BridgeArcLayout {
  height: number;
  left: number;
  top: number;
  width: number;
}

export function MobileClinical({
  activePatientId,
  mode,
  onMissingPatient,
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
  const [bridgeActive, setBridgeActive] = useState(false);
  const [bridgeLayout, setBridgeLayout] = useState<BridgeArcLayout | null>(null);
  const [recordedTeeth, setRecordedTeeth] = useState<Set<number>>(() => new Set());
  const [statusMessage, setStatusMessage] = useState("");
  const teeth = arch === "upper" ? upperTeeth : lowerTeeth;
  const bridgePreview = calculateBridgePreview(selectedTeeth);
  const visibleBridgePreview = bridgeActive ? bridgePreview : null;
  const bridgeKey = visibleBridgePreview?.includedTeeth.join("-") ?? "";

  useEffect(() => {
    if (!activePatientId) {
      onMissingPatient();
    }
  }, [activePatientId, onMissingPatient]);

  useEffect(() => {
    if (!sessionToken) {
      return;
    }
    void listClinicalServices(sessionToken)
      .then((items) => setServices(items.filter((service) => service.active)))
      .catch(() => setServices([]));
  }, [sessionToken]);

  useLayoutEffect(() => {
    const includedTeeth = bridgeKey ? bridgeKey.split("-").map(Number) : [];
    if (includedTeeth.length < 2 || !archRef.current) {
      setBridgeLayout(null);
      return;
    }

    function measureBridge() {
      if (!archRef.current) {
        return;
      }
      const containerRect = archRef.current.getBoundingClientRect();
      const rects = includedTeeth
        .map((tooth) => toothRefs.current[tooth]?.getBoundingClientRect())
        .filter((rect): rect is DOMRect => Boolean(rect));

      if (rects.length < 2) {
        setBridgeLayout(null);
        return;
      }

      const left = Math.min(...rects.map((rect) => rect.left)) - containerRect.left;
      const right = Math.max(...rects.map((rect) => rect.right)) - containerRect.left;
      const top = Math.max(0, Math.min(...rects.map((rect) => rect.top)) - containerRect.top - 30);

      setBridgeLayout({
        height: 34,
        left,
        top,
        width: Math.max(48, right - left)
      });
    }

    measureBridge();
    window.addEventListener("resize", measureBridge);
    return () => window.removeEventListener("resize", measureBridge);
  }, [arch, bridgeKey]);

  function handleToothPress(tooth: number) {
    if (!activePatientId) {
      return;
    }
    setActiveAction(null);
    setBridgeActive(false);
    if (selectionMode) {
      setSelectedTeeth((current) => {
        if (current.includes(tooth)) {
          return current.filter((item) => item !== tooth);
        }
        return [...current, tooth];
      });
      return;
    }
    setSelectedTeeth([tooth]);
  }

  function handleQuickAction(action: QuickAction) {
    if (!activePatientId) {
      return;
    }
    setBridgeActive(action === "crown" && selectedTeeth.length >= 2);
    setActiveAction(action);
  }

  async function handleServiceSelect(service: ClinicalService) {
    if (!activePatientId || !activeAction || !sessionToken) {
      return;
    }
    const targetTeeth = Array.from(
      new Set(
        activeAction === "crown" && bridgeActive && bridgePreview
          ? bridgePreview.includedTeeth
          : selectedTeeth
      )
    );
    if (targetTeeth.length === 0) {
      return;
    }

    await Promise.all(
      targetTeeth.map((tooth) =>
        createClinicalRecord(sessionToken, {
          patient_id: activePatientId,
          service_id: service.id,
          tooth_number: tooth,
          pathology_description: service.name,
          status: "diagnosed",
          ready_for_quote: true
        })
      )
    );

    setRecordedTeeth((current) => {
      const next = new Set(current);
      targetTeeth.forEach((tooth) => next.add(tooth));
      return next;
    });
    setStatusMessage(t("mobileClinicalServiceRegistered"));
    setSelectedTeeth([]);
    setSelectionMode(false);
    setActiveAction(null);
    setBridgeActive(false);
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
      </section>
    );
  }

  return (
    <section className="grid gap-4">
      <Button
        type="button"
        className="h-11 justify-center text-sm"
        onClick={() => {
          setArch((current) => (current === "upper" ? "lower" : "upper"));
          setSelectedTeeth([]);
          setSelectionMode(false);
          setActiveAction(null);
          setBridgeActive(false);
        }}
      >
        {t("mobileSwitchArch")} - {arch === "upper" ? t("mobileUpperArch") : t("mobileLowerArch")}
      </Button>

      <div className="rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">
            {arch === "upper" ? t("mobileUpperArch") : t("mobileLowerArch")}
          </p>
          {selectionMode ? (
            <span className="text-xs font-medium text-powder-blue-500">{t("mobileSelectionMode")}</span>
          ) : null}
        </div>
        <div ref={archRef} className="relative grid grid-cols-8 gap-2 overflow-visible pt-8">
          {visibleBridgePreview && bridgeLayout ? (
            <BridgeArc layout={bridgeLayout} />
          ) : null}
          {teeth.map((tooth) => {
            const selected = selectedTeeth.includes(tooth);
            const included = visibleBridgePreview?.includedTeeth.includes(tooth) ?? false;
            const recorded = recordedTeeth.has(tooth);
            return (
              <motion.button
                key={tooth}
                ref={(element) => {
                  toothRefs.current[tooth] = element;
                }}
                className={[
                  "relative z-20 flex h-14 flex-col items-center justify-center gap-0.5 rounded-md border text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-powder-blue-500/70",
                  selected
                    ? "border-powder-blue-500 bg-powder-blue-950 text-white"
                    : included
                      ? "border-pale-sky-500/50 bg-pale-sky-950 text-white"
                      : recorded
                        ? "border-emerald-500/40 bg-emerald-500/10 text-white"
                        : "border-alabaster-grey-500/20 bg-ink-black-950 text-alabaster-grey-500"
                ].join(" ")}
                type="button"
                whileTap={{ scale: 0.94 }}
                onClick={() => handleToothPress(tooth)}
              >
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
        {visibleBridgePreview ? (
          <p className="mt-3 text-xs text-alabaster-grey-500">
            {t("mobileBridgePreview")}: {visibleBridgePreview.unitCount}
          </p>
        ) : null}
        {statusMessage ? <p className="mt-3 text-xs text-powder-blue-500">{statusMessage}</p> : null}
        {selectedTeeth.length === 0 ? (
          <p className="mt-3 text-sm leading-6 text-alabaster-grey-500">
            {t("mobileClinicalNoDataInstruction")}
          </p>
        ) : null}
      </div>

      {selectedTeeth.length > 0 && !selectionMode ? (
        <QuickActions
          activeAction={activeAction}
          activePatientId={activePatientId}
          useBridge={selectedTeeth.length >= 2}
          onAction={handleQuickAction}
          onSelectionMode={() => setSelectionMode(true)}
        />
      ) : null}

      {activeAction ? (
        <MobileServiceOverlay
          services={services.filter((service) => service.category?.toLowerCase() === quickActionCategories[activeAction])}
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
    </section>
  );
}

function QuickActions({
  activeAction,
  activePatientId,
  useBridge,
  onAction,
  onSelectionMode
}: {
  activeAction: QuickAction | null;
  activePatientId: number;
  useBridge: boolean;
  onAction: (action: QuickAction) => void;
  onSelectionMode: () => void;
}) {
  const { t } = useL10n();
  const actions: { key: QuickAction; label: string }[] = [
    { key: "caries", label: t("mobileCaries") },
    { key: "endodontics", label: t("mobileEndodontics") },
    { key: "periodontics", label: t("mobilePeriodontics") },
    { key: "crown", label: useBridge ? t("mobileBridge") : t("mobileCrown") },
    { key: "extraction", label: t("mobileExtraction") },
    { key: "mobileProsthesis", label: t("mobileRemovableProsthesis") }
  ];

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          className="h-14 justify-center border-amber-500/40 bg-amber-500/20 text-white hover:bg-amber-500/30"
          onClick={onSelectionMode}
        >
          <Plus aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
          {t("mobileAddToSelection")}
        </Button>
        {actions.map((action) => (
          <Button
            key={action.key}
            type="button"
            variant={activeAction === action.key ? "navActive" : "secondary"}
            className="h-14 justify-center text-sm"
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
    <div className="fixed inset-0 z-50 grid content-end bg-black/45 p-4 backdrop-blur-sm">
      <div
        className="rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">{title}</p>
          <Button type="button" variant="secondary" className="h-10 justify-center" onClick={onClose}>
            {t("mobileCloseMenu")}
          </Button>
        </div>
        <div className="grid max-h-[48dvh] gap-2 overflow-y-auto">
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
    caries: t("mobileCaries"),
    crown: t("mobileCrown"),
    endodontics: t("mobileEndodontics"),
    extraction: t("mobileExtraction"),
    mobileProsthesis: t("mobileRemovableProsthesis"),
    periodontics: t("mobilePeriodontics")
  };
  return labels[action];
}

function MobileServicePanel({ services, title }: { services: ClinicalService[]; title: string }) {
  const { t } = useL10n();
  return (
    <div className="rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">{title}</p>
      <div className="mt-3 grid gap-2">
        {services.length ? (
          services.slice(0, 8).map((service) => (
            <Button key={service.id} type="button" variant="secondary" className="h-auto min-h-14 justify-start py-3 text-left">
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
      className="pointer-events-none absolute z-10 text-powder-blue-500"
      style={{
        height: layout.height,
        left: layout.left,
        top: layout.top,
        width: layout.width
      }}
      viewBox="0 0 100 34"
      preserveAspectRatio="none"
    >
      <path
        d="M4 30 C 24 2, 76 2, 96 30"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="5"
      />
    </svg>
  );
}
