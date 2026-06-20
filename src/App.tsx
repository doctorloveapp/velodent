import { AppShell } from "@/frontend/app-shell/AppShell";
import { L10nProvider } from "@/frontend/shared/i18n/L10nProvider";
import { useEffect, useState, type ReactNode } from "react";
import { Activity, KeyRound, ShieldCheck } from "lucide-react";
import { MobileApp } from "@/frontend/mobile/MobileApp";
import { MobilePairingGate } from "@/frontend/mobile/MobilePairingGate";
import { clearStoredLanDeviceToken, isLanSessionToken } from "@/frontend/mobile/lanBridgeApi";
import { DEFAULT_FIRST_ADMIN_GOOGLE_EMAIL } from "@/frontend/settings/authConfig";
import {
  bootstrapStatus,
  activateLicense,
  createFirstAdmin,
  isTauriRuntime,
  licenseStatus,
  login,
  startGoogleLogin,
  type LicenseStatus,
  type User
} from "@/frontend/settings/settingsApi";
import { Button } from "@/frontend/shared/ui/button";
import { Input } from "@/frontend/shared/ui/input";
import { useL10n } from "@/frontend/shared/i18n/L10nProvider";

export default function App() {
  return (
    <L10nProvider locale="it">
      <AuthGate />
    </L10nProvider>
  );
}

function AuthGate() {
  const { t } = useL10n();
  const [backendAvailable] = useState(isTauriRuntime());
  const [checking, setChecking] = useState(true);
  const [licenseChecking, setLicenseChecking] = useState(true);
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [activationKey, setActivationKey] = useState("");
  const [needsFirstAdmin, setNeedsFirstAdmin] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [adminForm, setAdminForm] = useState({
    username: "admin",
    password: "",
    googleEmail: DEFAULT_FIRST_ADMIN_GOOGLE_EMAIL
  });
  const [loginForm, setLoginForm] = useState({ username: "admin", password: "" });

  useEffect(() => {
    if (!backendAvailable) {
      setLicenseChecking(false);
      setChecking(false);
      return;
    }

    void licenseStatus()
      .then((status) => {
        setLicense(status);
      })
      .catch((error: unknown) => {
        setStatusMessage(error instanceof Error ? error.message : t("authGateGenericError"));
      })
      .finally(() => setLicenseChecking(false));
  }, [backendAvailable, t]);

  useEffect(() => {
    if (!backendAvailable || licenseChecking || !license?.activated) {
      setChecking(false);
      return;
    }

    setChecking(true);
    void bootstrapStatus()
      .then((status) => {
        setNeedsFirstAdmin(status.needs_first_admin);
      })
      .catch((error: unknown) => {
        setStatusMessage(error instanceof Error ? error.message : t("authGateGenericError"));
      })
      .finally(() => setChecking(false));
  }, [backendAvailable, license?.activated, licenseChecking, t]);

  async function handleActivateLicense() {
    const nextLicense = await activateLicense(activationKey);
    setLicense(nextLicense);
    setStatusMessage(t("licenseActivationSuccess"));
  }

  async function handleCreateFirstAdmin() {
    const user = await createFirstAdmin({
      username: adminForm.username,
      password: adminForm.password,
      google_email: adminForm.googleEmail || undefined
    });
    setCurrentUser(user);
    setNeedsFirstAdmin(false);
  }

  async function handleLogin() {
    setCurrentUser(await login(loginForm));
  }

  async function handleStartGoogleLogin() {
    setStatusMessage(t("authGateGoogleBrowserOpening"));
    setCurrentUser(await startGoogleLogin());
  }

  if (currentUser?.session_token) {
    return isLanSessionToken(currentUser.session_token) || shouldUseMobileShell() ? (
      <MobileApp
        currentUser={currentUser}
        onLogout={() => {
          if (currentUser.session_token && isLanSessionToken(currentUser.session_token)) {
            clearStoredLanDeviceToken();
          }
          setCurrentUser(null);
        }}
      />
    ) : (
      <AppShell currentUser={currentUser} />
    );
  }

  if (!backendAvailable) {
    return <MobilePairingGate onPaired={setCurrentUser} />;
  }

  if (licenseChecking || checking) {
    return (
      <AuthSurface
        icon={<Activity aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />}
        title={t("authGateCheckingTitle")}
        eyebrow={t("settingsSecurityEyebrow")}
      >
        <p className="text-sm text-alabaster-grey-500">{t("healthChecking")}</p>
      </AuthSurface>
    );
  }

  if (!license?.activated) {
    return (
      <AuthSurface
        icon={<ShieldCheck aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />}
        title={t("licenseLockedTitle")}
        eyebrow={t("licenseLockedEyebrow")}
      >
        <div className="grid gap-3">
          <p className="text-sm leading-6 text-alabaster-grey-500">{t("licenseLockedBody")}</p>
          <div className="rounded-md border border-powder-blue-500/25 bg-ink-black-950 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-alabaster-grey-500">{t("licenseHardwareId")}</p>
            <p className="mt-2 font-mono text-lg font-semibold text-white">{license?.hardware_id ?? "VD-0000-0000-0000"}</p>
          </div>
          <Input
            placeholder={t("licenseActivationKey")}
            value={activationKey}
            onChange={(event) => setActivationKey(event.target.value)}
          />
          <Button type="button" onClick={() => void handleActivateLicense().catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("licenseActivationError")))}>
            {t("licenseActivate")}
          </Button>
          {statusMessage ? <p className="text-xs leading-5 text-alabaster-grey-500">{statusMessage}</p> : null}
        </div>
      </AuthSurface>
    );
  }

  return needsFirstAdmin ? (
    <AuthSurface
      icon={<ShieldCheck aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />}
      title={t("settingsFirstAdminTitle")}
      eyebrow={t("settingsSecurityEyebrow")}
    >
      <div className="grid gap-3">
        <p className="text-sm leading-6 text-alabaster-grey-500">{t("authGateFirstAdminHelp")}</p>
        <Input placeholder={t("settingsUsername")} value={adminForm.username} onChange={(event) => setAdminForm({ ...adminForm, username: event.target.value })} />
        <Input placeholder={t("settingsPassword")} type="password" value={adminForm.password} onChange={(event) => setAdminForm({ ...adminForm, password: event.target.value })} />
        <Input placeholder={t("settingsGoogleEmail")} value={adminForm.googleEmail} onChange={(event) => setAdminForm({ ...adminForm, googleEmail: event.target.value })} />
        <Button type="button" onClick={() => void handleCreateFirstAdmin().catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("authGateGenericError")))}>
          {t("settingsCreateFirstAdmin")}
        </Button>
        {statusMessage ? <p className="text-xs text-alabaster-grey-500">{statusMessage}</p> : null}
      </div>
    </AuthSurface>
  ) : (
    <AuthSurface
      icon={<KeyRound aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />}
      title={t("settingsLoginTitle")}
      eyebrow={t("settingsSecurityEyebrow")}
    >
      <div className="grid gap-3">
        <Input placeholder={t("settingsUsername")} value={loginForm.username} onChange={(event) => setLoginForm({ ...loginForm, username: event.target.value })} />
        <Input placeholder={t("settingsPassword")} type="password" value={loginForm.password} onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })} />
        <Button type="button" onClick={() => void handleLogin().catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("authGateGenericError")))}>
          {t("settingsLoginAction")}
        </Button>
        <GoogleLoginControls
          statusMessage={statusMessage}
          onStart={() => void handleStartGoogleLogin().catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("authGateGenericError")))}
        />
      </div>
    </AuthSurface>
  );
}

function shouldUseMobileShell() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("mobile") === "1") {
    return true;
  }
  return window.matchMedia("(pointer: coarse) and (max-width: 1024px)").matches;
}

function AuthSurface({ children, eyebrow, icon, title }: { children: ReactNode; eyebrow: string; icon: ReactNode; title: string }) {
  const { t } = useL10n();

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-black-950 p-6 text-ink-black-50">
      <section className="w-full max-w-[440px] rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.42)]">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md border border-powder-blue-500/30 bg-powder-blue-950 text-powder-blue-500">
            {icon}
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">{eyebrow}</p>
            <h1 className="text-lg font-semibold text-white">{title}</h1>
          </div>
        </div>
        {children}
        <p className="mt-5 border-t border-alabaster-grey-500/15 pt-4 text-[11px] leading-5 text-alabaster-grey-500">
          {t("authGateSecurityNote")}
        </p>
      </section>
    </main>
  );
}

function GoogleLoginControls({
  onStart,
  statusMessage
}: {
  onStart: () => void;
  statusMessage: string;
}) {
  const { t } = useL10n();

  return (
    <div className="grid gap-3 border-t border-alabaster-grey-500/15 pt-4">
      <Button type="button" variant="secondary" className="h-11 justify-center border-powder-blue-500/40 bg-powder-blue-950 text-white hover:bg-powder-blue-900" onClick={onStart}>
        {t("authGateGoogleLogin")}
      </Button>
      <p className="text-xs leading-5 text-alabaster-grey-500">{t("authGateGoogleBrowserHelp")}</p>
      {statusMessage ? <p className="text-xs leading-5 text-alabaster-grey-500">{statusMessage}</p> : null}
    </div>
  );
}
