import { Download, Link, ShieldCheck, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { useL10n } from "@/frontend/shared/i18n/L10nProvider";
import { Button } from "@/frontend/shared/ui/button";
import { Input } from "@/frontend/shared/ui/input";
import type { User } from "@/frontend/settings/settingsApi";
import {
  clearStoredLanDeviceToken,
  lanBridgeBaseUrl,
  lanCurrentUser,
  lanHealth,
  pairLanDevice,
  storedLanDeviceToken
} from "./lanBridgeApi";

interface MobilePairingGateProps {
  onPaired: (user: User) => void;
}

export function MobilePairingGate({ onPaired }: MobilePairingGateProps) {
  const { t } = useL10n();
  const [pin, setPin] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [checking, setChecking] = useState(true);
  const [setupRequired, setSetupRequired] = useState(() => setupRequestedFromUrl());
  const [setupMessage, setSetupMessage] = useState("");
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  useEffect(() => {
    if (setupRequired) {
      setChecking(false);
      return;
    }
    let mounted = true;
    const pairingPin = pairingPinFromUrl();
    const token = storedLanDeviceToken();
    if (!token) {
      if (!pairingPin) {
        setChecking(false);
        return;
      }
      setPin(pairingPin);
      setStatusMessage(t("mobilePairingConnecting"));
      void lanHealth()
        .then(() => pairLanDevice(pairingPin))
        .then((nextToken) => lanCurrentUser(nextToken))
        .then((user) => {
          if (mounted) {
            window.sessionStorage.setItem("velodent:pwa-install-prompt", "1");
            window.history.replaceState(null, "", window.location.pathname + "?mobile=1");
            onPaired(user);
          }
        })
        .catch(() => {
          clearStoredLanDeviceToken();
          if (mounted) {
            setStatusMessage(t("mobilePairingFailed"));
          }
        })
        .finally(() => {
          if (mounted) {
            setChecking(false);
          }
        });
      return;
    }
    void lanHealth()
      .then(() => lanCurrentUser(token))
      .then((user) => {
        if (mounted) {
          if (pairingPin) {
            window.sessionStorage.setItem("velodent:pwa-install-prompt", "1");
            window.history.replaceState(null, "", window.location.pathname + "?mobile=1");
          }
          onPaired(user);
        }
      })
      .catch(() => {
        clearStoredLanDeviceToken();
        if (mounted) {
          setStatusMessage(t("mobilePairingStoredTokenInvalid"));
        }
      })
      .finally(() => {
        if (mounted) {
          setChecking(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [onPaired, setupRequired, t]);

  function handleCertificateSetup() {
    const link = document.createElement("a");
    link.href = `${lanBridgeBaseUrl()}/ca.crt`;
    link.download = "velodent-local-ca.crt";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setSetupMessage(t("mobileSetupDownloadStarted"));
  }

  async function handleInstall() {
    if (!installPrompt) {
      return;
    }
    await installPrompt.prompt();
    setInstallPrompt(null);
  }

  async function handlePair() {
    setStatusMessage(t("mobilePairingConnecting"));
    await lanHealth();
    const token = await pairLanDevice(pin);
    const user = await lanCurrentUser(token);
    window.sessionStorage.setItem("velodent:pwa-install-prompt", "1");
    onPaired(user);
  }

  return (
    <main
      className="flex min-h-[100dvh] items-center justify-center bg-ink-black-950 p-4 text-ink-black-50"
      style={{
        paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
        paddingTop: "calc(1rem + env(safe-area-inset-top))"
      }}
    >
      {setupRequired ? (
      <section className="w-full max-w-[460px] rounded-xl border border-powder-blue-500/30 bg-glaucous-950 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.42)]">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-md border border-powder-blue-500/30 bg-powder-blue-950 text-powder-blue-500">
            <Smartphone aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">
              {t("mobilePairingEyebrow")}
            </p>
            <h1 className="text-xl font-semibold text-white">{t("mobileSetupTitle")}</h1>
          </div>
        </div>
        <p className="text-sm leading-6 text-alabaster-grey-500">{t("mobileSetupBody")}</p>
        {isIosDevice() ? (
          <div className="mt-4 rounded-md border border-powder-blue-500/25 bg-powder-blue-950/50 p-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-pale-sky-500">
              {t("mobileSetupIosTitle")}
            </p>
            <ol className="mt-2 grid gap-2 text-sm leading-6 text-alabaster-grey-500">
              <li>{t("mobileSetupIosStepOne")}</li>
              <li>{t("mobileSetupIosStepTwo")}</li>
            </ol>
          </div>
        ) : null}
        <div className="mt-5 grid gap-3">
          <Button
            type="button"
            className="h-16 justify-center text-base uppercase tracking-[0.14em]"
            onClick={handleCertificateSetup}
          >
            <Download aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
            {t("mobileSetupConfigure")}
          </Button>
          {setupMessage ? <p className="text-xs leading-5 text-alabaster-grey-500">{setupMessage}</p> : null}
          {installPrompt ? (
            <Button
              type="button"
              className="h-12 justify-center border-powder-blue-500/35 bg-powder-blue-950 px-4 text-sm font-semibold uppercase tracking-[0.14em] text-powder-blue-100 shadow-[0_0_18px_rgba(47,127,208,0.12)] hover:bg-powder-blue-500/20 hover:shadow-[0_0_26px_rgba(47,127,208,0.2)]"
              onClick={() => void handleInstall()}
            >
              {t("mobileInstallVeloDent")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            className="h-12 justify-center"
            onClick={() => setSetupRequired(false)}
          >
            {t("mobileSetupContinue")}
          </Button>
        </div>
      </section>
      ) : (
      <section className="w-full max-w-[440px] rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.42)]">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-md border border-powder-blue-500/30 bg-powder-blue-950 text-powder-blue-500">
            <Link aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">
              {t("mobilePairingEyebrow")}
            </p>
            <h1 className="text-xl font-semibold text-white">{t("mobilePairingTitle")}</h1>
          </div>
        </div>

        <p className="text-sm leading-6 text-alabaster-grey-500">
          {checking ? t("mobilePairingChecking") : t("mobilePairingBody")}
        </p>

        <div className="mt-5 grid gap-3">
          <Input
            className="h-14 text-center font-mono text-2xl tracking-[0.35em]"
            inputMode="numeric"
            maxLength={6}
            placeholder={t("mobilePairingPinPlaceholder")}
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
          />
          <Button
            type="button"
            className="h-14 justify-center text-base"
            disabled={checking || pin.length !== 6}
            onClick={() => void handlePair().catch(() => {
              clearStoredLanDeviceToken();
              setStatusMessage(t("mobilePairingFailed"));
            })}
          >
            <ShieldCheck aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
            {t("mobilePairingConnect")}
          </Button>
          {statusMessage ? <p className="text-xs leading-5 text-alabaster-grey-500">{statusMessage}</p> : null}
        </div>
      </section>
      )}
    </main>
  );
}

function setupRequestedFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("setup") === "1";
}

function pairingPinFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const value = params.get("pairing_pin") ?? params.get("pin");
  return value?.replace(/\D/g, "").slice(0, 6) ?? "";
}

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}
