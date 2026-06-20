import { Check, Plus } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { listClinicalServices, type ClinicalService } from "@/frontend/clinical/clinicalApi";
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
  mode: ClinicalMobileMode;
  sessionToken: string;
}

export function MobileClinical({ mode, sessionToken }: MobileClinicalProps) {
  const { t } = useL10n();
  const [services, setServices] = useState<ClinicalService[]>([]);
  const [arch, setArch] = useState<ArchMode>("upper");
  const [selectedTeeth, setSelectedTeeth] = useState<number[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [activeAction, setActiveAction] = useState<QuickAction | null>(null);
  const teeth = arch === "upper" ? upperTeeth : lowerTeeth;
  const bridgePreview = calculateBridgePreview(selectedTeeth);

  useEffect(() => {
    if (!sessionToken) {
      return;
    }
    void listClinicalServices(sessionToken)
      .then((items) => setServices(items.filter((service) => service.active)))
      .catch(() => setServices([]));
  }, [sessionToken]);

  function handleToothPress(tooth: number) {
    setActiveAction(null);
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
        className="h-14 justify-center text-base"
        onClick={() => {
          setArch((current) => (current === "upper" ? "lower" : "upper"));
          setSelectedTeeth([]);
          setSelectionMode(false);
          setActiveAction(null);
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
        <div className="relative grid grid-cols-8 gap-2 pt-6">
          {bridgePreview ? (
            <BridgeArc teeth={teeth} includedTeeth={bridgePreview.includedTeeth} />
          ) : null}
          {teeth.map((tooth) => {
            const selected = selectedTeeth.includes(tooth);
            const included = bridgePreview?.includedTeeth.includes(tooth) ?? false;
            return (
              <motion.button
                key={tooth}
                className={[
                  "relative grid h-14 place-items-center rounded-md border text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-powder-blue-500/70",
                  selected
                    ? "border-powder-blue-500 bg-powder-blue-950 text-white"
                    : included
                      ? "border-pale-sky-500/50 bg-pale-sky-950 text-white"
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
                {tooth}
              </motion.button>
            );
          })}
        </div>
        {bridgePreview ? (
          <p className="mt-3 text-xs text-alabaster-grey-500">
            {t("mobileBridgePreview")}: {bridgePreview.unitCount}
          </p>
        ) : null}
      </div>

      {selectedTeeth.length > 0 && !selectionMode ? (
        <QuickActions
          activeAction={activeAction}
          services={services}
          useBridge={selectedTeeth.length >= 2}
          onAction={setActiveAction}
          onSelectionMode={() => setSelectionMode(true)}
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
  services,
  useBridge,
  onAction,
  onSelectionMode
}: {
  activeAction: QuickAction | null;
  services: ClinicalService[];
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
  const filtered = activeAction
    ? services.filter((service) => service.category?.toLowerCase() === quickActionCategories[activeAction])
    : [];

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-2">
        {actions.map((action) => (
          <Button
            key={action.key}
            type="button"
            variant={activeAction === action.key ? "navActive" : "secondary"}
            className="h-14 justify-center text-sm"
            onClick={() => onAction(action.key)}
          >
            {action.label}
          </Button>
        ))}
        <Button
          type="button"
          className="h-14 justify-center border-amber-500/40 bg-amber-500/20 text-white hover:bg-amber-500/30"
          onClick={onSelectionMode}
        >
          <Plus aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
          {t("mobileAddToSelection")}
        </Button>
      </div>
      {activeAction ? <MobileServicePanel services={filtered} title={actions.find((action) => action.key === activeAction)?.label ?? ""} /> : null}
    </div>
  );
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

function BridgeArc({ includedTeeth, teeth }: { includedTeeth: number[]; teeth: number[] }) {
  const includedIndexes = includedTeeth
    .map((tooth) => teeth.indexOf(tooth))
    .filter((index) => index >= 0);
  if (includedIndexes.length < 2) {
    return null;
  }
  const min = Math.min(...includedIndexes);
  const max = Math.max(...includedIndexes);
  const left = `${String((min / 8) * 100)}%`;
  const width = `${String(((max - min + 1) / 8) * 100)}%`;
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute top-0 z-10 h-8 text-powder-blue-500"
      style={{ left, width }}
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
    >
      <path
        d="M4 28 C 24 2, 76 2, 96 28"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="5"
      />
    </svg>
  );
}
