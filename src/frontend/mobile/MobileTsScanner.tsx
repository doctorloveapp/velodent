import { X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { readTsCns, type TsCnsPatientData } from "@/frontend/patients/patientsApi";
import { useL10n } from "@/frontend/shared/i18n/L10nProvider";
import { Button } from "@/frontend/shared/ui/button";

type ScannerState = "waiting" | "reading" | "error";

interface MobileTsScannerProps {
  open: boolean;
  sessionToken: string;
  onClose: () => void;
  onManualEntry: () => void;
  onSuccess: (data: TsCnsPatientData) => void;
}

export function MobileTsScanner({
  open,
  sessionToken,
  onClose,
  onManualEntry,
  onSuccess
}: MobileTsScannerProps) {
  const { t } = useL10n();
  const [scannerState, setScannerState] = useState<ScannerState>("waiting");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    setScannerState("waiting");
    const readingTimer = window.setTimeout(() => {
      if (!cancelled) {
        setScannerState("reading");
      }
    }, 650);

    void readTsCns(sessionToken)
      .then((data) => {
        if (cancelled) {
          return;
        }
        if ("vibrate" in navigator) {
          navigator.vibrate(80);
        }
        onSuccess(data);
      })
      .catch(() => {
        if (!cancelled) {
          setScannerState("error");
        }
      })
      .finally(() => window.clearTimeout(readingTimer));

    return () => {
      cancelled = true;
      window.clearTimeout(readingTimer);
    };
  }, [attempt, onSuccess, open, sessionToken]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-50 grid bg-ink-black-950/96 p-4 text-ink-black-50 backdrop-blur"
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          style={{
            paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
            paddingTop: "calc(1rem + env(safe-area-inset-top))"
          }}
          transition={{ duration: 0.18 }}
        >
          <div className="mx-auto flex h-full w-full max-w-[460px] flex-col">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">
                  {t("mobileHealthCardReader")}
                </p>
                <h2 className="text-lg font-semibold text-white">{t("mobileScannerTitle")}</h2>
              </div>
              <Button
                aria-label={t("mobileScannerCancel")}
                className="h-11 w-11 p-0"
                type="button"
                variant="secondary"
                onClick={onClose}
              >
                <X aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
              </Button>
            </div>

            {scannerState === "error" ? (
              <div className="grid flex-1 content-center gap-5">
                <div className="rounded-xl border border-rose-600/40 bg-glaucous-950 p-5">
                  <h3 className="text-xl font-semibold text-white">{t("mobileScannerErrorTitle")}</h3>
                  <p className="mt-3 text-sm leading-6 text-alabaster-grey-500">
                    {t("mobileScannerErrorBody")}
                  </p>
                </div>
                <div className="grid gap-3">
                  <Button type="button" className="h-14 justify-center text-base" onClick={() => setAttempt((current) => current + 1)}>
                    {t("mobileRetry")}
                  </Button>
                  <Button type="button" variant="secondary" className="h-14 justify-center text-base" onClick={onManualEntry}>
                    {t("mobileManualEntry")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid flex-1 content-center justify-items-center gap-8 text-center">
                <div className="relative grid h-48 w-48 place-items-center">
                  <motion.span
                    animate={{ opacity: [0.6, 0], scale: [0.7, 1.45] }}
                    className="absolute h-40 w-40 rounded-full border border-powder-blue-500/50"
                    transition={{ duration: 1.35, ease: "easeOut", repeat: Infinity }}
                  />
                  <motion.span
                    animate={{ opacity: [0.5, 0], scale: [0.55, 1.18] }}
                    className="absolute h-32 w-32 rounded-full border border-pale-sky-500/45"
                    transition={{ delay: 0.2, duration: 1.2, ease: "easeOut", repeat: Infinity }}
                  />
                  <motion.div
                    animate={{ scale: scannerState === "reading" ? [1, 1.04, 1] : 1 }}
                    className="relative grid h-24 w-24 place-items-center rounded-full border border-powder-blue-500/40 bg-powder-blue-950 text-powder-blue-500 shadow-[0_0_42px_rgba(47,127,208,0.32)]"
                    transition={{ duration: 0.9, repeat: Infinity }}
                  >
                    <span className="h-10 w-14 rounded-md border border-current" />
                  </motion.div>
                </div>

                <div className="max-w-[320px]">
                  <p className="text-xl font-semibold text-white">
                    {scannerState === "reading" ? t("mobileScannerReading") : t("mobileScannerWaiting")}
                  </p>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
