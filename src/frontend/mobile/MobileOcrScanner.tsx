import { Camera, Focus, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { createWorker, OEM, PSM } from "tesseract.js";
import type { TsCnsPatientData } from "@/frontend/patients/patientsApi";
import { useL10n } from "@/frontend/shared/i18n/L10nProvider";
import { Button } from "@/frontend/shared/ui/button";

interface MobileOcrScannerProps {
  open: boolean;
  onClose: () => void;
  onManualEntry: () => void;
  onSuccess: (data: TsCnsPatientData) => void;
}

type OcrWorker = Awaited<ReturnType<typeof createWorker>>;

interface FocusCapabilities extends MediaTrackCapabilities {
  focusDistance?: { max?: number; min?: number; step?: number };
  focusMode?: string[];
}

interface FocusConstraintSet extends MediaTrackConstraintSet {
  focusDistance?: number;
  focusMode?: string;
}

let sharedOcrWorkerPromise: Promise<OcrWorker> | null = null;

export function MobileOcrScanner({ open, onClose, onManualEntry, onSuccess }: MobileOcrScannerProps) {
  const { t } = useL10n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [statusMessage, setStatusMessage] = useState(t("mobileOcrWaiting"));
  const [processing, setProcessing] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);

  useEffect(() => {
    if (!open) {
      stopCamera(streamRef.current);
      streamRef.current = null;
      setCameraReady(false);
      return;
    }

    let cancelled = false;
    setStatusMessage(t("mobileOcrWaiting"));
    setCameraReady(false);

    void getOcrWorker().catch((error: unknown) => {
      logOcrError("worker warmup failed", error);
    });

    const mediaDevices = Reflect.get(navigator, "mediaDevices") as MediaDevices | undefined;
    if (!mediaDevices || typeof mediaDevices.getUserMedia !== "function") {
      console.error("VeloDent OCR camera error: navigator.mediaDevices.getUserMedia unavailable");
      setStatusMessage(t("mobileOcrCameraUnavailable"));
      return () => {
        cancelled = true;
      };
    }

    void mediaDevices
      .getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          frameRate: { ideal: 30 },
          height: { ideal: 1440 },
          width: { ideal: 2560 }
        }
      })
      .then(async (stream) => {
        if (cancelled) {
          stopCamera(stream);
          return;
        }

        streamRef.current = stream;
        await applyContinuousFocus(stream);

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch((error: unknown) => {
            logOcrError("video play failed", error);
          });
        }

        logCameraSettings(stream);
        setCameraReady(true);
        setStatusMessage(t("mobileOcrTapToFocus"));
      })
      .catch((error: unknown) => {
        logOcrError("camera getUserMedia failed", error);
        setStatusMessage(t("mobileOcrCameraUnavailable"));
      });

    return () => {
      cancelled = true;
      stopCamera(streamRef.current);
      streamRef.current = null;
      setCameraReady(false);
    };
  }, [open, t]);

  async function handleCapture() {
    const video = videoRef.current;
    if (!video || !cameraReady) {
      setStatusMessage(t("mobileOcrCameraUnavailable"));
      return;
    }
    setProcessing(true);
    setStatusMessage(t("mobileOcrProcessing"));
    try {
      const image = captureAndPreprocessVideoFrame(video);
      const data = await extractHealthCardData(image);
      onSuccess(data);
    } catch (error) {
      logOcrError("OCR recognition failed", error);
      setStatusMessage(t("mobileOcrEngineUnavailable"));
    } finally {
      setProcessing(false);
    }
  }

  async function handleTapToFocus(event: React.PointerEvent<HTMLDivElement>) {
    const stream = streamRef.current;
    if (!stream) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const focusX = (event.clientX - bounds.left) / bounds.width;
    const focusY = (event.clientY - bounds.top) / bounds.height;
    const focused = await tryTapToFocus(stream, focusX, focusY);
    setStatusMessage(t(focused ? "mobileOcrFocusApplied" : "mobileOcrFocusUnsupported"));
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

            <div
              className="relative min-h-0 flex-1 touch-manipulation overflow-hidden rounded-xl border border-alabaster-grey-500/20 bg-black"
              onPointerDown={(event) => void handleTapToFocus(event)}
            >
              <video ref={videoRef} autoPlay className="h-full w-full object-cover" muted playsInline />
              <div className="pointer-events-none absolute inset-x-6 top-1/2 h-40 -translate-y-1/2 rounded-xl border-2 border-powder-blue-500/70 shadow-[0_0_32px_rgba(47,127,208,0.28)]" />
              <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 rounded-full border border-powder-blue-500/30 bg-ink-black-950/80 px-3 py-2 text-xs text-powder-blue-100">
                <Focus aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
                {t("mobileOcrTapToFocus")}
              </div>
            </div>

            <p className="text-sm leading-6 text-alabaster-grey-500">{statusMessage}</p>

            <div className="grid gap-3">
              <Button
                type="button"
                className="h-14 justify-center text-base"
                disabled={processing || !cameraReady}
                onClick={() => void handleCapture()}
              >
                <Camera aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
                {t("mobileOcrCapture")}
              </Button>
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

function getOcrWorker() {
  sharedOcrWorkerPromise ??= createWorker("ita+eng", OEM.LSTM_ONLY, {
    corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0",
    errorHandler: (error: unknown) => logOcrError("worker internal error", error),
    langPath: "https://tessdata.projectnaptha.com/4.0.0",
    logger: (message) => {
      console.info("VeloDent OCR worker", message.status, Math.round(message.progress * 100));
    },
    workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js"
  }).then(async (worker) => {
    await worker.setParameters({
      preserve_interword_spaces: "1",
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' /.-",
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      user_defined_dpi: "300"
    });
    return worker;
  }).catch((error: unknown) => {
    sharedOcrWorkerPromise = null;
    throw error;
  });

  return sharedOcrWorkerPromise;
}

function captureAndPreprocessVideoFrame(video: HTMLVideoElement) {
  const sourceWidth = video.videoWidth || 1920;
  const sourceHeight = video.videoHeight || 1080;
  const targetWidth = Math.min(sourceWidth, 2560);
  const targetHeight = Math.round((targetWidth / sourceWidth) * sourceHeight);
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("canvas unavailable");
  }

  context.drawImage(video, 0, 0, targetWidth, targetHeight);
  const imageData = context.getImageData(0, 0, targetWidth, targetHeight);
  const pixels = imageData.data;
  for (let index = 0; index < pixels.length; index += 4) {
    const grey = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
    const contrasted = clamp((grey - 128) * 1.55 + 138);
    const sharpened = contrasted > 188 ? 255 : contrasted < 72 ? 0 : contrasted;
    pixels[index] = sharpened;
    pixels[index + 1] = sharpened;
    pixels[index + 2] = sharpened;
  }
  context.putImageData(imageData, 0, 0);

  return canvas.toDataURL("image/png");
}

async function extractHealthCardData(image: string): Promise<TsCnsPatientData> {
  const worker = await getOcrWorker();
  const result = await worker.recognize(image);
  console.info("VeloDent OCR recognized characters", result.data.text.length);
  return parseHealthCardText(result.data.text);
}

export function parseHealthCardText(text: string): TsCnsPatientData {
  const normalizedText = normalizeOcrText(text);
  const taxCodeMatch = /[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]/.exec(normalizedText);
  const taxCode = taxCodeMatch?.[0] ?? "";
  const birthDate = parseBirthDate(normalizedText) || parseBirthDateFromTaxCode(taxCode);
  const lines = normalizedText
    .split(/\r?\n/)
    .map((line) => line.replace(/[^A-Z0-9' /.-]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const lastName = findLabelValue(lines, ["COGNOME", "SURNAME"]) || findNameCandidate(lines, 0);
  const firstName = findLabelValue(lines, ["NOME", "NAME"]) || findNameCandidate(lines, 1);

  if (!taxCode || !birthDate || !firstName || !lastName) {
    console.info("VeloDent OCR parse incomplete", {
      birthDateDetected: Boolean(birthDate),
      firstNameDetected: Boolean(firstName),
      lastNameDetected: Boolean(lastName),
      taxCodeDetected: Boolean(taxCode)
    });
    throw new Error("ocr parse incomplete");
  }

  return {
    date_of_birth: birthDate,
    first_name: normalizeName(firstName),
    last_name: normalizeName(lastName),
    tax_code: taxCode
  };
}

function normalizeOcrText(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[|]/g, "I")
    .replace(/[`]/g, "'");
}

function findLabelValue(lines: string[], labels: string[]) {
  for (const label of labels) {
    const labelIndex = lines.findIndex((line) => line === label || line.startsWith(`${label} `));
    if (labelIndex >= 0) {
      const sameLineValue = lines[labelIndex].replace(label, "").trim();
      if (isNameLine(sameLineValue)) {
        return sameLineValue;
      }
      const nextLine = lines[labelIndex + 1] ?? "";
      if (isNameLine(nextLine)) {
        return nextLine;
      }
    }
  }
  return "";
}

function findNameCandidate(lines: string[], offset: number) {
  const candidates = lines.filter((line) => {
    if (!isNameLine(line)) {
      return false;
    }
    return !/(TESSERA|SANITARIA|MINISTERO|SALUTE|REPUBBLICA|ITALIANA|CODICE|FISCALE|DATA|NASCITA|SCADENZA|EUROPEA|SERVIZIO|REGIONE)/.test(line);
  });
  return candidates[offset] ?? "";
}

function isNameLine(value: string) {
  return /^[A-Z' -]{2,}$/.test(value.trim());
}

function parseBirthDate(text: string) {
  const match = /\b([0-3]?\d)[/.-]([01]?\d)[/.-]((?:19|20)\d{2})\b/.exec(text);
  if (!match) {
    return "";
  }
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function parseBirthDateFromTaxCode(taxCode: string) {
  if (!/^[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]$/.test(taxCode)) {
    return "";
  }
  const yearCode = Number(taxCode.slice(6, 8));
  const monthCode = taxCode[8];
  const dayCode = Number(taxCode.slice(9, 11));
  const month = "ABCDEHLMPRST".indexOf(monthCode) + 1;
  if (!month || !Number.isFinite(yearCode) || !Number.isFinite(dayCode)) {
    return "";
  }
  const day = dayCode > 40 ? dayCode - 40 : dayCode;
  const currentYear = new Date().getFullYear() % 100;
  const fullYear = yearCode <= currentYear ? 2000 + yearCode : 1900 + yearCode;
  return `${String(fullYear)}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeName(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

async function applyContinuousFocus(stream: MediaStream) {
  const track = stream.getVideoTracks()[0];
  const capabilities = getFocusCapabilities(track);
  if (!capabilities.focusMode?.includes("continuous")) {
    return;
  }
  await applyFocusConstraints(track, { focusMode: "continuous" }).catch((error: unknown) => {
    logOcrError("continuous focus failed", error);
  });
}

async function tryTapToFocus(stream: MediaStream, focusX: number, focusY: number) {
  const track = stream.getVideoTracks()[0];
  const capabilities = getFocusCapabilities(track);
  if (!capabilities.focusMode?.includes("manual")) {
    await applyContinuousFocus(stream);
    return false;
  }

  const focusDistance = calculateFocusDistance(capabilities, focusY);
  await applyFocusConstraints(track, {
    focusDistance,
    focusMode: "manual"
  });
  window.setTimeout(() => {
    void applyContinuousFocus(stream);
  }, 1200);
  console.info("VeloDent OCR tap-to-focus", { focusDistance, focusX, focusY });
  return true;
}

function calculateFocusDistance(capabilities: FocusCapabilities, focusY: number) {
  const minimum = capabilities.focusDistance?.min ?? 0;
  const maximum = capabilities.focusDistance?.max ?? 1;
  const range = Math.max(maximum - minimum, 0);
  const closeBias = 1 - Math.min(Math.max(focusY, 0), 1);
  return minimum + range * Math.max(0.2, closeBias * 0.45);
}

function getFocusCapabilities(track: MediaStreamTrack): FocusCapabilities {
  return track.getCapabilities();
}

function applyFocusConstraints(track: MediaStreamTrack, constraints: FocusConstraintSet) {
  return track.applyConstraints({
    advanced: [constraints]
  });
}

function logCameraSettings(stream: MediaStream) {
  const track = stream.getVideoTracks()[0];
  console.info("VeloDent OCR camera settings", track.getSettings());
  console.info("VeloDent OCR camera capabilities", getFocusCapabilities(track));
}

function logOcrError(context: string, error: unknown) {
  if (error instanceof Error) {
    console.error(`VeloDent OCR ${context}: ${error.name}: ${error.message}`, error);
    return;
  }
  console.error(`VeloDent OCR ${context}:`, error);
}

function clamp(value: number) {
  return Math.max(0, Math.min(255, value));
}

function stopCamera(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}
