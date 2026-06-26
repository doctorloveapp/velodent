import { RotateCcw, Save } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent } from "react";
import {
  listConsentTemplates,
  renderConsentTemplate,
  signPatientConsent,
  type ConsentTemplate,
  type RenderedConsent
} from "@/frontend/consents/consentsApi";
import type { Patient } from "@/frontend/patients/patientsApi";
import { useL10n } from "@/frontend/shared/i18n/L10nProvider";
import { Badge } from "@/frontend/shared/ui/badge";
import { Button } from "@/frontend/shared/ui/button";

interface MobileConsentsProps {
  patient: Patient;
  sessionToken: string;
}

export function MobileConsents({ patient, sessionToken }: MobileConsentsProps) {
  const { t } = useL10n();
  const [templates, setTemplates] = useState<ConsentTemplate[]>([]);
  const [rendered, setRendered] = useState<RenderedConsent | null>(null);
  const [checks, setChecks] = useState<boolean[]>([]);
  const [signatureReady, setSignatureReady] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

  const activeTemplates = useMemo(() => templates.filter((template) => template.active), [templates]);
  const requiredChecksDone = rendered
    ? checks.slice(0, rendered.required_checkbox_count).every(Boolean) && checks.length >= rendered.required_checkbox_count
    : false;
  const canSign = Boolean(rendered && requiredChecksDone && signatureReady && !saving);

  useEffect(() => {
    void listConsentTemplates(sessionToken)
      .then((nextTemplates) => setTemplates(nextTemplates))
      .catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("mobileConsentGenericError")));
  }, [sessionToken, t]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !rendered) {
      return;
    }
    resizeSignatureCanvas(canvas);
    setSignatureReady(false);
  }, [rendered?.template.id]);

  async function selectTemplate(templateId: number) {
    const nextRendered = await renderConsentTemplate(sessionToken, patient.id, templateId);
    setRendered(nextRendered);
    setChecks(Array.from({ length: nextRendered.required_checkbox_count }, () => false));
    setStatusMessage("");
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    setSignatureReady(false);
  }

  async function handleSign() {
    const canvas = canvasRef.current;
    if (!rendered || !canvas) {
      return;
    }
    setSaving(true);
    try {
      await signPatientConsent(sessionToken, {
        patient_id: patient.id,
        template_id: rendered.template.id,
        checkbox_confirmations: checks,
        signature_data_url: canvas.toDataURL("image/png")
      });
      setStatusMessage(t("mobileConsentSigned"));
      setRendered(null);
      clearSignature();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : t("mobileConsentGenericError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="grid min-h-[calc(100dvh-7.5rem)] content-between gap-4">
      <div className="grid gap-4">
        <div className="rounded-xl border border-powder-blue-500/20 bg-glaucous-950 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">
            {t("mobileConsentPatient")}
          </p>
          <h1 className="mt-2 text-xl font-semibold text-white">
            {patient.last_name} {patient.first_name}
          </h1>
          {statusMessage ? <p className="mt-2 text-sm text-alabaster-grey-500">{statusMessage}</p> : null}
        </div>

        <div className="grid gap-2">
          {activeTemplates.map((template) => (
            <button
              key={template.id}
              className={[
                "min-h-16 rounded-xl border px-4 py-3 text-left transition-colors",
                rendered?.template.id === template.id
                  ? "border-powder-blue-500/60 bg-powder-blue-950 text-white"
                  : "border-alabaster-grey-500/20 bg-glaucous-950 text-alabaster-grey-500"
              ].join(" ")}
              type="button"
              onClick={() => void selectTemplate(template.id).catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("mobileConsentGenericError")))}
            >
              <span className="block text-base font-semibold">{template.title}</span>
              <span className="mt-1 block font-mono text-[11px] uppercase tracking-widest">{template.template_key}</span>
            </button>
          ))}
          {activeTemplates.length === 0 ? (
            <p className="rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-4 text-sm text-alabaster-grey-500">
              {t("mobileConsentNoTemplates")}
            </p>
          ) : null}
        </div>

        {rendered ? (
          <div className="grid gap-4 rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-4">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">{rendered.template.title}</h2>
              <Badge variant={requiredChecksDone ? "success" : "warning"}>{t("mobileConsentRequiredChecks")}</Badge>
            </div>
            <ConsentBody
              checks={checks}
              renderedBody={rendered.rendered_body}
              onCheck={(index, checked) => setChecks((current) => current.map((value, valueIndex) => (valueIndex === index ? checked : value)))}
            />
            <div className="rounded-xl border border-powder-blue-500/25 bg-ink-black-950 p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">
                    {t("mobileConsentSignatureTitle")}
                  </p>
                  <p className="mt-1 text-xs text-alabaster-grey-500 sm:hidden">{t("mobileConsentRotatePhone")}</p>
                </div>
                <Button type="button" variant="secondary" size="sm" onClick={clearSignature}>
                  <RotateCcw aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
                  {t("mobileConsentClearSignature")}
                </Button>
              </div>
              <canvas
                ref={canvasRef}
                className="h-44 w-full touch-none rounded-lg border border-alabaster-grey-500/20 bg-white"
                onPointerDown={(event) => startDrawing(event, canvasRef.current, drawingRef)}
                onPointerLeave={() => {
                  drawingRef.current = false;
                }}
                onPointerMove={(event) => drawSignature(event, canvasRef.current, drawingRef, () => setSignatureReady(true))}
                onPointerUp={() => {
                  drawingRef.current = false;
                }}
              />
            </div>
          </div>
        ) : null}
      </div>

      <div
        className="sticky bottom-0 -mx-4 border-t border-alabaster-grey-500/20 bg-ink-black-950/95 px-4 py-3 backdrop-blur"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <Button disabled={!canSign} type="button" className="h-14 w-full justify-center text-base" onClick={() => void handleSign()}>
          {saving ? (
            t("saving")
          ) : (
            <>
              <Save aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
              {t("mobileConsentSign")}
            </>
          )}
        </Button>
      </div>
    </section>
  );
}

function ConsentBody({
  checks,
  onCheck,
  renderedBody
}: {
  checks: boolean[];
  onCheck: (index: number, checked: boolean) => void;
  renderedBody: string;
}) {
  let checkboxIndex = -1;
  return (
    <div className="grid gap-2 rounded-lg border border-alabaster-grey-500/20 bg-ink-black-950 p-3 text-sm leading-6 text-alabaster-grey-100">
      {renderedBody.split(/\r?\n/).map((line, lineIndex) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("[ ]")) {
          checkboxIndex += 1;
          const currentIndex = checkboxIndex;
          return (
            <label key={`${String(lineIndex)}-${trimmed}`} className="flex items-start gap-3 rounded-md border border-alabaster-grey-500/15 bg-glaucous-950 p-3">
              <input
                checked={checks[currentIndex] ?? false}
                className="mt-1 h-5 w-5 accent-powder-blue-500"
                type="checkbox"
                onChange={(event) => onCheck(currentIndex, event.target.checked)}
              />
              <span>{trimmed.replace("[ ]", "").trim()}</span>
            </label>
          );
        }
        return <p key={`${String(lineIndex)}-${trimmed}`}>{trimmed}</p>;
      })}
    </div>
  );
}

function resizeSignatureCanvas(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  const context = canvas.getContext("2d");
  if (context) {
    context.scale(ratio, ratio);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 3;
    context.strokeStyle = "#070f1c";
  }
}

function startDrawing(
  event: PointerEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement | null,
  drawingRef: MutableRefObject<boolean>
) {
  if (!canvas) {
    return;
  }
  drawingRef.current = true;
  const point = pointerPoint(event, canvas);
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  context.beginPath();
  context.moveTo(point.x, point.y);
}

function drawSignature(
  event: PointerEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement | null,
  drawingRef: MutableRefObject<boolean>,
  onSigned: () => void
) {
  if (!drawingRef.current || !canvas) {
    return;
  }
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  const point = pointerPoint(event, canvas);
  context.lineTo(point.x, point.y);
  context.stroke();
  onSigned();
}

function pointerPoint(event: PointerEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}
