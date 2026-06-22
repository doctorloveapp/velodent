import { Link, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useL10n } from "@/frontend/shared/i18n/L10nProvider";
import { Button } from "@/frontend/shared/ui/button";
import { Input } from "@/frontend/shared/ui/input";
import type { User } from "@/frontend/settings/settingsApi";
import {
  clearStoredLanDeviceToken,
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

  useEffect(() => {
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
  }, [onPaired, t]);

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
    </main>
  );
}

function pairingPinFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const value = params.get("pairing_pin") ?? params.get("pin");
  return value?.replace(/\D/g, "").slice(0, 6) ?? "";
}
