import { CheckCircle2, Copy, KeyRound, ShieldCheck, X } from "lucide-react";
import { useRef, useState } from "react";
import { useL10n } from "@/frontend/shared/i18n/L10nProvider";
import { Button } from "@/frontend/shared/ui/button";
import { Input } from "@/frontend/shared/ui/input";
import { APP_VERSION } from "@/frontend/shared/appVersion";
import {
  activateLicense,
  isTauriRuntime,
  licenseStatus,
  type LicenseStatus
} from "@/frontend/settings/settingsApi";

const SECRET_CLICK_COUNT = 5;
const SECRET_CLICK_WINDOW_MS = 1_500;

interface LicenseActivationEasterEggProps {
  className?: string;
  compact?: boolean;
}

export function LicenseActivationEasterEgg({ className = "", compact = false }: LicenseActivationEasterEggProps) {
  const { t } = useL10n();
  const clickState = useRef({ count: 0, lastClickAt: 0 });
  const [activationKey, setActivationKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const versionLabel = t("settingsAppVersionValue").replace("{version}", APP_VERSION);

  async function openActivationWindow() {
    setMessage("");
    setActivationKey("");
    setOpen(true);
    if (!isTauriRuntime()) {
      setLicense(null);
      setMessage(t("licenseActivationDesktopOnly"));
      return;
    }
    try {
      setLicense(await licenseStatus());
    } catch (error) {
      setLicense(null);
      setMessage(error instanceof Error ? error.message : t("licenseActivationError"));
    }
  }

  function handleVersionClick() {
    const now = Date.now();
    const current = clickState.current;
    current.count = now - current.lastClickAt <= SECRET_CLICK_WINDOW_MS ? current.count + 1 : 1;
    current.lastClickAt = now;
    if (current.count >= SECRET_CLICK_COUNT) {
      current.count = 0;
      void openActivationWindow();
    }
  }

  async function handleCopyRequestCode() {
    if (!license?.request_code) {
      return;
    }
    try {
      await navigator.clipboard.writeText(license.request_code);
      setMessage(t("licenseRequestCodeCopied"));
    } catch {
      setMessage(t("licenseActivationError"));
    }
  }

  async function handleActivate() {
    if (!activationKey.trim()) {
      setMessage(t("licenseActivationError"));
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const nextLicense = await activateLicense("", activationKey);
      setLicense(nextLicense);
      setActivationKey("");
      setMessage(t("licenseActivationSuccess"));
      window.dispatchEvent(new CustomEvent<LicenseStatus>("velodent-license-activated", { detail: nextLicense }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("licenseActivationError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={[
          "inline-flex items-center gap-1 rounded px-2 py-1 font-mono text-[11px] font-semibold text-alabaster-grey-500 transition-colors hover:text-powder-blue-500",
          className
        ].join(" ")}
        onClick={handleVersionClick}
      >
        {compact ? null : <span>{t("settingsAppVersion")}</span>}
        <span>{versionLabel}</span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-ink-black-950/78 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-lg border border-powder-blue-500/25 bg-glaucous-950 p-5 shadow-[0_28px_90px_rgba(0,0,0,0.58)]">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-powder-blue-500/35 bg-powder-blue-950 text-powder-blue-500">
                  {license?.activated ? (
                    <CheckCircle2 aria-hidden="true" className="h-5 w-5" strokeWidth={1.6} />
                  ) : (
                    <ShieldCheck aria-hidden="true" className="h-5 w-5" strokeWidth={1.6} />
                  )}
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">
                    {t("licenseLockedEyebrow")}
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-white">
                    {license?.activated ? t("licenseEnterpriseActiveTitle") : t("licenseEarlyActivationTitle")}
                  </h2>
                </div>
              </div>
              <Button
                aria-label={t("commonClose")}
                className="h-10 w-10 justify-center p-0"
                type="button"
                variant="secondary"
                onClick={() => setOpen(false)}
              >
                <X aria-hidden="true" className="h-4 w-4" strokeWidth={1.6} />
              </Button>
            </div>

            {!license && message ? (
              <div className="mt-5 rounded-md border border-amber-500/25 bg-amber-500/10 p-4 text-sm font-semibold leading-6 text-amber-100">
                {message}
              </div>
            ) : license?.activated ? (
              <div className="mt-5 rounded-md border border-emerald-500/25 bg-emerald-500/10 p-4 text-sm font-semibold leading-6 text-emerald-100">
                {t("licenseEnterpriseActiveVerified")}
              </div>
            ) : (
              <div className="mt-5 grid gap-4">
                <p className="text-sm leading-6 text-alabaster-grey-500">{t("licenseEarlyActivationBody")}</p>
                {license?.request_code ? (
                  <div className="rounded-md border border-powder-blue-500/25 bg-ink-black-950 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">
                      {t("licenseRequestCode")}
                    </p>
                    <p className="mt-2 break-all font-mono text-sm font-semibold leading-6 text-white">
                      {license.request_code}
                    </p>
                    <Button className="mt-3" type="button" variant="secondary" onClick={() => void handleCopyRequestCode()}>
                      <Copy aria-hidden="true" className="h-4 w-4" strokeWidth={1.6} />
                      {t("licenseCopyRequestCode")}
                    </Button>
                  </div>
                ) : null}
                <Input
                  placeholder={t("licenseActivationKey")}
                  value={activationKey}
                  onChange={(event) => setActivationKey(event.target.value)}
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button disabled={busy} type="button" onClick={() => void handleActivate()}>
                    <KeyRound aria-hidden="true" className="h-4 w-4" strokeWidth={1.6} />
                    {t("licenseActivate")}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                    {t("commonClose")}
                  </Button>
                </div>
              </div>
            )}
            {license && message ? <p className="mt-4 text-xs leading-5 text-alabaster-grey-500">{message}</p> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
