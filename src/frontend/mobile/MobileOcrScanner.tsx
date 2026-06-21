import { Camera, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { TsCnsPatientData } from "@/frontend/patients/patientsApi";
import { useL10n } from "@/frontend/shared/i18n/L10nProvider";
import { Button } from "@/frontend/shared/ui/button";

declare global {
  interface Window {
    Tesseract?: {
      recognize: (image: string, language?: string) => Promise<{ data: { text: string } }>;
    };
  }
}

interface MobileOcrScannerProps {
  open: boolean;
  onClose: () => void;
  onManualEntry: () => void;
  onSuccess: (data: TsCnsPatientData) => void;
}

export function MobileOcrScanner({ open, onClose, onManualEntry, onSuccess }: MobileOcrScannerProps) {
  const { t } = useL10n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [statusMessage, setStatusMessage] = useState(t("mobileOcrWaiting"));
  const [processing, setProcessing] = useState(false);
  const canSimulate = import.meta.env.DEV || !window.Tesseract;

  useEffect(() => {
    if (!open) {
      stopCamera(streamRef.current);
      streamRef.current = null;
      return;
    }

    let cancelled = false;
    setStatusMessage(t("mobileOcrWaiting"));

    try {
      void navigator.mediaDevices
        .getUserMedia({ video: { facingMode: { ideal: "environment" } } })
        .then((stream) => {
          if (cancelled) {
            stopCamera(stream);
            return;
          }
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        })
        .catch(() => setStatusMessage(t("mobileOcrCameraUnavailable")));
    } catch {
      setStatusMessage(t("mobileOcrCameraUnavailable"));
    }

    return () => {
      cancelled = true;
      stopCamera(streamRef.current);
      streamRef.current = null;
    };
  }, [open, t]);

  async function handleCapture() {
    const video = videoRef.current;
    if (!video) {
      setStatusMessage(t("mobileOcrCameraUnavailable"));
      return;
    }
    setProcessing(true);
    setStatusMessage(t("mobileOcrProcessing"));
    try {
      const image = captureVideoFrame(video);
      const data = await extractHealthCardData(image);
      onSuccess(data);
    } catch {
      setStatusMessage(t("mobileOcrEngineUnavailable"));
    } finally {
      setProcessing(false);
    }
  }

  function handleSimulate() {
    onSuccess({
      date_of_birth: "1980-01-01",
      first_name: "Mario",
      last_name: "Rossi",
      tax_code: "RSSMRA80A01H501U"
    });
  }

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
          <div className="mx-auto flex h-full w-full max-w-[460px] flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">
                  {t("mobileHealthCardOcr")}
                </p>
                <h2 className="text-lg font-semibold text-white">{t("mobileOcrScannerTitle")}</h2>
              </div>
              <Button
                aria-label={t("mobileScannerCancel")}
                className="h-11 w-11 justify-center p-0"
                type="button"
                variant="secondary"
                onClick={onClose}
              >
                <X aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
              </Button>
            </div>

            <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-alabaster-grey-500/20 bg-black">
              <video
                ref={videoRef}
                autoPlay
                className="h-full w-full object-cover"
                muted
                playsInline
              />
              <div className="pointer-events-none absolute inset-x-8 top-1/2 h-36 -translate-y-1/2 rounded-xl border-2 border-powder-blue-500/70 shadow-[0_0_32px_rgba(47,127,208,0.28)]" />
            </div>

            <p className="text-sm leading-6 text-alabaster-grey-500">{statusMessage}</p>

            <div className="grid gap-3">
              <Button type="button" className="h-14 justify-center text-base" disabled={processing} onClick={() => void handleCapture()}>
                <Camera aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
                {t("mobileOcrCapture")}
              </Button>
              {canSimulate ? (
                <Button type="button" variant="secondary" className="h-12 justify-center text-sm" onClick={handleSimulate}>
                  {t("mobileOcrSimulateTest")}
                </Button>
              ) : null}
              <Button type="button" variant="secondary" className="h-12 justify-center text-sm" onClick={onManualEntry}>
                {t("mobileManualEntry")}
              </Button>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function captureVideoFrame(video: HTMLVideoElement) {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("canvas unavailable");
  }
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

async function extractHealthCardData(image: string): Promise<TsCnsPatientData> {
  if (!window.Tesseract) {
    throw new Error("ocr unavailable");
  }
  const result = await window.Tesseract.recognize(image, "ita");
  return parseHealthCardText(result.data.text);
}

function parseHealthCardText(text: string): TsCnsPatientData {
  const taxCodeMatch = /[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]/i.exec(text);
  const taxCode = taxCodeMatch?.[0].toUpperCase();
  const birthDate = parseBirthDate(text);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[A-ZÀ-Ü' -]{2,}$/i.test(line));
  const lastName = lines[0] ?? "";
  const firstName = lines[1] ?? "";

  if (!taxCode || !birthDate || !firstName || !lastName) {
    throw new Error("ocr parse incomplete");
  }

  return {
    date_of_birth: birthDate,
    first_name: normalizeName(firstName),
    last_name: normalizeName(lastName),
    tax_code: taxCode
  };
}

function parseBirthDate(text: string) {
  const match = /\b([0-3]?\d)[/.-]([01]?\d)[/.-]((?:19|20)\d{2})\b/.exec(text);
  if (!match) {
    return "";
  }
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function normalizeName(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function stopCamera(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}
