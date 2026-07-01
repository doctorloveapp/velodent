import { AppShell } from "@/frontend/app-shell/AppShell";
import { L10nProvider } from "@/frontend/shared/i18n/L10nProvider";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState, type ReactNode } from "react";
import { Activity, ArrowLeft, Building2, CalendarCheck, CheckCircle2, KeyRound, RotateCcw, ShieldCheck, UploadCloud } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { MobileApp } from "@/frontend/mobile/MobileApp";
import { MobilePairingGate } from "@/frontend/mobile/MobilePairingGate";
import {
  clearStoredLanDeviceToken,
  isLanSessionToken,
  isLanTokenRejected,
  restoreLanCurrentUser,
  storedLanDeviceToken
} from "@/frontend/mobile/lanBridgeApi";
import {
  bootstrapStatus,
  activateLicense,
  createFirstAdmin,
  isTauriRuntime,
  licenseStatus,
  login,
  pickBackupFile,
  restoreOnboardingBackup,
  startGoogleCalendarAccountLink,
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
  const [lanAutoLoginChecking, setLanAutoLoginChecking] = useState(() => !isTauriRuntime() && Boolean(storedLanDeviceToken()));
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [activationEmail, setActivationEmail] = useState("");
  const [activationKey, setActivationKey] = useState("");
  const [needsFirstAdmin, setNeedsFirstAdmin] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [adminForm, setAdminForm] = useState({
    username: "admin",
    password: "",
    confirmPassword: ""
  });
  const [onboardingChoice, setOnboardingChoice] = useState<"new" | "restore" | null>(null);
  const [onboardingStep, setOnboardingStep] = useState<"choice" | "new" | "restore" | "calendar">("choice");
  const [onboardingUser, setOnboardingUser] = useState<User | null>(null);
  const [onboardingCalendarLinked, setOnboardingCalendarLinked] = useState(false);
  const [restoreForm, setRestoreForm] = useState({ backupPath: "", password: "" });
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: "admin", password: "" });
  const [migrationRequestOpen, setMigrationRequestOpen] = useState(false);

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
    function handleLicenseActivated(event: Event) {
      const nextLicense = (event as CustomEvent<LicenseStatus>).detail;
      if (nextLicense) {
        setLicense(nextLicense);
      }
    }

    window.addEventListener("velodent-license-activated", handleLicenseActivated);
    return () => window.removeEventListener("velodent-license-activated", handleLicenseActivated);
  }, []);

  useEffect(() => {
    if (backendAvailable) {
      return;
    }
    const token = storedLanDeviceToken();
    if (!token) {
      setLanAutoLoginChecking(false);
      return;
    }
    setLanAutoLoginChecking(true);
    void restoreLanCurrentUser(token)
      .then((user) => setCurrentUser(user))
      .catch((error: unknown) => {
        if (isLanTokenRejected(error)) {
          clearStoredLanDeviceToken();
        }
      })
      .finally(() => setLanAutoLoginChecking(false));
  }, [backendAvailable]);

  useEffect(() => {
    if (!backendAvailable || licenseChecking || !license?.allowed) {
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
  }, [backendAvailable, license?.allowed, licenseChecking, t]);

  useEffect(() => {
    if (!backendAvailable || onboardingStep !== "calendar" || !onboardingUser) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen("velodent-google-calendar-linked", () => {
      if (disposed) {
        return;
      }
      setOnboardingCalendarLinked(true);
      setStatusMessage(t("onboardingCalendarConnected"));
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
      } else {
        unlisten = nextUnlisten;
      }
    });

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [backendAvailable, onboardingStep, onboardingUser?.id, t]);

  async function handleActivateLicense() {
    const nextLicense = await activateLicense(activationEmail, activationKey);
    setLicense(nextLicense);
    setStatusMessage(t("licenseActivationSuccess"));
  }

  async function handleCreateFirstAdmin() {
    const user = await createFirstAdmin({
      username: adminForm.username,
      password: adminForm.password
    });
    setOnboardingUser(user);
    setOnboardingCalendarLinked(false);
    setOnboardingStep("calendar");
    setStatusMessage(t("onboardingAdminCreated"));
  }

  async function handleLinkOnboardingCalendar() {
    if (!onboardingUser?.session_token) {
      return;
    }
    setOnboardingBusy(true);
    setOnboardingCalendarLinked(false);
    try {
      await startGoogleCalendarAccountLink(onboardingUser.session_token, true, adminForm.password);
      setOnboardingCalendarLinked(true);
      setNeedsFirstAdmin(false);
      setCurrentUser(onboardingUser);
      setStatusMessage(t("onboardingCalendarConnected"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusMessage(message.includes("oauth callback timed out") ? t("onboardingCalendarTimeout") : t("onboardingCalendarLinkFailed"));
    } finally {
      setOnboardingBusy(false);
    }
  }

  function handleSkipOnboardingCalendar() {
    if (!onboardingUser) {
      return;
    }
    setOnboardingCalendarLinked(false);
    setNeedsFirstAdmin(false);
    setCurrentUser(onboardingUser);
    setStatusMessage(t("onboardingCalendarSkipped"));
  }

  async function handlePickOnboardingBackup() {
    const selected = await pickBackupFile();
    if (selected) {
      setRestoreForm((current) => ({ ...current, backupPath: selected }));
    }
  }

  async function handleRestoreOnboardingBackup() {
    setOnboardingBusy(true);
    try {
      const nextLicense = await restoreOnboardingBackup(restoreForm.password, restoreForm.backupPath);
      setLicense(nextLicense);
      setNeedsFirstAdmin(false);
      setStatusMessage(t("onboardingRestoreCompleted"));
    } finally {
      setOnboardingBusy(false);
    }
  }

  async function handleLogin() {
    try {
      setStatusMessage("");
      setCurrentUser(await login(loginForm));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusMessage(message.toLowerCase().includes("invalid credentials") ? t("authGateInvalidCredentials") : t("authGateGenericError"));
    }
  }

  if (currentUser?.session_token) {
    const shell = isLanSessionToken(currentUser.session_token) || shouldUseMobileShell() ? (
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

    return (
      <MigrationGraceFrame
        license={license}
        requestOpen={migrationRequestOpen}
        onCloseRequest={() => setMigrationRequestOpen(false)}
        onLicenseActivated={setLicense}
        onOpenRequest={() => setMigrationRequestOpen(true)}
      >
        {shell}
      </MigrationGraceFrame>
    );
  }

  if (!backendAvailable) {
    if (lanAutoLoginChecking) {
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
    return <MobilePairingGate onPaired={setCurrentUser} />;
  }

  if (licenseChecking || checking || lanAutoLoginChecking) {
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

  if (!license?.allowed) {
    return (
      <AuthSurface
        icon={<ShieldCheck aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />}
        title={t("licenseLockedTitle")}
        eyebrow={t("licenseLockedEyebrow")}
      >
        <div className="grid gap-3">
          <p className="text-sm leading-6 text-alabaster-grey-500">{t("licenseLockedBody")}</p>
          <p className="text-sm font-semibold text-powder-blue-500">{t("licenseSupportEmail")}</p>
          <div className="rounded-md border border-powder-blue-500/25 bg-ink-black-950 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-alabaster-grey-500">{t("licenseRequestCode")}</p>
            <p className="mt-2 break-all font-mono text-lg font-semibold text-white">{license?.request_code ?? "VD-0000-0000-0000-0000"}</p>
          </div>
          <Input
            placeholder={t("licenseEmail")}
            type="email"
            value={activationEmail}
            onChange={(event) => setActivationEmail(event.target.value)}
          />
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
    <OnboardingWizard
      adminForm={adminForm}
      busy={onboardingBusy}
      calendarLinked={onboardingCalendarLinked}
      choice={onboardingChoice}
      restoreForm={restoreForm}
      statusMessage={statusMessage}
      step={onboardingStep}
      onBack={() => {
        setStatusMessage("");
        setOnboardingStep("choice");
      }}
      onChoiceChange={setOnboardingChoice}
      onContinue={() => {
        if (onboardingChoice) {
          setStatusMessage("");
          setOnboardingStep(onboardingChoice);
        }
      }}
      onCreateAdmin={() => void handleCreateFirstAdmin().catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("authGateGenericError")))}
      onLinkCalendar={() => void handleLinkOnboardingCalendar().catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("authGateGenericError")))}
      onPickBackup={() => void handlePickOnboardingBackup().catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("authGateGenericError")))}
      onRestore={() => void handleRestoreOnboardingBackup().catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("authGateGenericError")))}
      onSkipCalendar={handleSkipOnboardingCalendar}
      onAdminFormChange={setAdminForm}
      onRestoreFormChange={setRestoreForm}
    />
  ) : (
    <AuthSurface
      icon={<KeyRound aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />}
      title={t("settingsLoginTitle")}
      eyebrow={t("settingsSecurityEyebrow")}
    >
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void handleLogin();
        }}
      >
        <Input placeholder={t("settingsUsername")} value={loginForm.username} onChange={(event) => setLoginForm({ ...loginForm, username: event.target.value })} />
        <Input autoFocus placeholder={t("settingsPassword")} type="password" value={loginForm.password} onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })} />
        <Button type="submit">
          {t("settingsLoginAction")}
        </Button>
        {statusMessage ? <p className="text-xs leading-5 text-alabaster-grey-500">{statusMessage}</p> : null}
      </form>
    </AuthSurface>
  );
}

function MigrationGraceFrame({
  children,
  license,
  requestOpen,
  onCloseRequest,
  onLicenseActivated,
  onOpenRequest
}: {
  children: ReactNode;
  license: LicenseStatus | null;
  requestOpen: boolean;
  onCloseRequest: () => void;
  onLicenseActivated: (license: LicenseStatus) => void;
  onOpenRequest: () => void;
}) {
  const { t } = useL10n();
  const [activationEmail, setActivationEmail] = useState("");
  const [activationKey, setActivationKey] = useState("");
  const [activationBusy, setActivationBusy] = useState(false);
  const [activationMessage, setActivationMessage] = useState("");
  if (!license?.migration_grace_active) {
    return <>{children}</>;
  }
  const days = String(Math.max(0, license.migration_grace_days_remaining));

  async function handleMigrationActivation() {
    setActivationBusy(true);
    setActivationMessage("");
    try {
      const nextLicense = await activateLicense(activationEmail, activationKey);
      onLicenseActivated(nextLicense);
      setActivationKey("");
      setActivationMessage(t("licenseActivationSuccess"));
      if (nextLicense.allowed && !nextLicense.migration_grace_active) {
        onCloseRequest();
      }
    } catch (error) {
      setActivationMessage(error instanceof Error ? error.message : t("licenseActivationError"));
    } finally {
      setActivationBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-ink-black-950">
      <div className="fixed inset-x-0 top-0 z-[70] border-b border-amber-400/30 bg-ink-black-950/95 px-4 py-3 shadow-[0_16px_42px_rgba(0,0,0,0.35)] backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-300">{t("licenseMigrationGraceEyebrow")}</p>
            <p className="mt-1 text-sm font-semibold leading-5 text-white">
              {t("licenseMigrationGraceBanner").replace("{days}", days)}
            </p>
          </div>
          <Button type="button" variant="secondary" onClick={onOpenRequest}>
            {t("licenseMigrationRequestAction")}
          </Button>
        </div>
      </div>
      <div className="pt-[88px]">{children}</div>
      {requestOpen ? (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-ink-black-950/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-md border border-powder-blue-500/25 bg-glaucous-950 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.5)]">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-powder-blue-500">{t("licenseRequestCode")}</p>
            <h2 className="mt-2 text-xl font-semibold text-white">{t("licenseMigrationRequestTitle")}</h2>
            <p className="mt-3 text-sm leading-6 text-alabaster-grey-500">{t("licenseMigrationRequestBody")}</p>
            <div className="mt-4 rounded-md border border-powder-blue-500/25 bg-ink-black-950 p-3">
              <p className="break-all font-mono text-sm font-semibold leading-6 text-white">{license.request_code}</p>
            </div>
            <div className="mt-4 grid gap-3 border-t border-alabaster-grey-500/15 pt-4">
              <Input
                placeholder={t("licenseEmail")}
                type="email"
                value={activationEmail}
                onChange={(event) => setActivationEmail(event.target.value)}
              />
              <Input
                placeholder={t("licenseActivationKey")}
                value={activationKey}
                onChange={(event) => setActivationKey(event.target.value)}
              />
              <Button
                disabled={activationBusy}
                type="button"
                onClick={() => void handleMigrationActivation()}
              >
                {t("licenseActivate")}
              </Button>
              {activationMessage ? <p className="text-xs leading-5 text-alabaster-grey-500">{activationMessage}</p> : null}
            </div>
            <div className="mt-5 flex justify-end">
              <Button type="button" onClick={onCloseRequest}>{t("commonClose")}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface OnboardingWizardProps {
  adminForm: { username: string; password: string; confirmPassword: string };
  busy: boolean;
  calendarLinked: boolean;
  choice: "new" | "restore" | null;
  restoreForm: { backupPath: string; password: string };
  statusMessage: string;
  step: "choice" | "new" | "restore" | "calendar";
  onAdminFormChange: (form: { username: string; password: string; confirmPassword: string }) => void;
  onBack: () => void;
  onChoiceChange: (choice: "new" | "restore") => void;
  onContinue: () => void;
  onCreateAdmin: () => void;
  onLinkCalendar: () => void;
  onPickBackup: () => void;
  onRestore: () => void;
  onSkipCalendar: () => void;
  onRestoreFormChange: (form: { backupPath: string; password: string }) => void;
}

function OnboardingWizard({
  adminForm,
  busy,
  calendarLinked,
  choice,
  restoreForm,
  statusMessage,
  step,
  onAdminFormChange,
  onBack,
  onChoiceChange,
  onContinue,
  onCreateAdmin,
  onLinkCalendar,
  onPickBackup,
  onRestore,
  onSkipCalendar,
  onRestoreFormChange
}: OnboardingWizardProps) {
  const { t } = useL10n();
  const passwordsMatch = adminForm.password.length > 0 && adminForm.password === adminForm.confirmPassword;
  const restoreReady = restoreForm.backupPath.trim().length > 0 && restoreForm.password.length > 0;

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-black-950 p-4 text-ink-black-50 sm:p-6">
      <section className="flex max-h-[calc(100vh-2rem)] w-full max-w-[820px] flex-col overflow-hidden rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 shadow-[0_24px_80px_rgba(0,0,0,0.42)]">
        <div className="border-b border-alabaster-grey-500/15 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-powder-blue-500/30 bg-powder-blue-950 text-powder-blue-500">
              <ShieldCheck aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">{t("onboardingEyebrow")}</p>
              <h1 className="text-xl font-semibold text-white">{t("onboardingTitle")}</h1>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          <AnimatePresence mode="wait">
            {step === "choice" ? (
              <motion.div
                key="choice"
                animate={{ opacity: 1, y: 0 }}
                className="grid gap-4"
                exit={{ opacity: 0, y: -8 }}
                initial={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.18 }}
              >
                <p className="max-w-2xl text-sm leading-6 text-alabaster-grey-500">{t("onboardingChoiceBody")}</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <OnboardingChoiceCard
                    active={choice === "new"}
                    body={t("onboardingNewStudioBody")}
                    icon={<Building2 aria-hidden="true" className="h-6 w-6" strokeWidth={1.5} />}
                    title={t("onboardingNewStudioTitle")}
                    onClick={() => onChoiceChange("new")}
                  />
                  <OnboardingChoiceCard
                    active={choice === "restore"}
                    body={t("onboardingRestoreStudioBody")}
                    icon={<RotateCcw aria-hidden="true" className="h-6 w-6" strokeWidth={1.5} />}
                    title={t("onboardingRestoreStudioTitle")}
                    onClick={() => onChoiceChange("restore")}
                  />
                </div>
              </motion.div>
            ) : null}

            {step === "new" ? (
              <motion.form
                key="new"
                animate={{ opacity: 1, x: 0 }}
                className="grid gap-4"
                exit={{ opacity: 0, x: -12 }}
                initial={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.18 }}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (passwordsMatch && !busy) {
                    onCreateAdmin();
                  }
                }}
              >
                <StepHeader body={t("onboardingNewFormBody")} title={t("onboardingNewFormTitle")} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    autoFocus
                    placeholder={t("onboardingNewPassword")}
                    type="password"
                    value={adminForm.password}
                    onChange={(event) => onAdminFormChange({ ...adminForm, password: event.target.value })}
                  />
                  <Input
                    placeholder={t("onboardingConfirmPassword")}
                    type="password"
                    value={adminForm.confirmPassword}
                    onChange={(event) => onAdminFormChange({ ...adminForm, confirmPassword: event.target.value })}
                  />
                </div>
                <Button disabled={!passwordsMatch || busy} type="submit">
                  <ShieldCheck aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
                  {t("onboardingSaveAdmin")}
                </Button>
                {adminForm.confirmPassword && !passwordsMatch ? <p className="text-xs text-red-300">{t("onboardingPasswordMismatch")}</p> : null}
              </motion.form>
            ) : null}

            {step === "calendar" ? (
              <motion.div
                key="calendar"
                animate={{ opacity: 1, x: 0 }}
                className="grid gap-4"
                exit={{ opacity: 0, x: -12 }}
                initial={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.18 }}
              >
                <StepHeader body={t("onboardingCalendarBody")} title={t("onboardingCalendarTitle")} />
                <div className="rounded-lg border border-powder-blue-500/25 bg-ink-black-950 p-4">
                  <div className="flex items-start gap-3">
                    <CalendarCheck aria-hidden="true" className="mt-1 h-5 w-5 text-powder-blue-500" strokeWidth={1.6} />
                    <p className="text-sm leading-6 text-alabaster-grey-500">{t("onboardingCalendarRequired")}</p>
                  </div>
                  <div className="mt-4">
                    <span className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold ${
                      calendarLinked
                        ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
                        : busy
                          ? "border-powder-blue-500/25 bg-powder-blue-950/30 text-powder-blue-200"
                          : "border-amber-400/25 bg-amber-400/10 text-amber-200"
                    }`}>
                      <span className={`h-2 w-2 rounded-full ${calendarLinked ? "bg-emerald-400" : busy ? "bg-powder-blue-500" : "bg-amber-400"}`} />
                      {calendarLinked ? t("onboardingCalendarStatusConnected") : busy ? t("onboardingCalendarStatusWaiting") : t("onboardingCalendarStatusDisconnected")}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy} type="button" onClick={onLinkCalendar}>
                    <CalendarCheck aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
                    {busy ? t("onboardingCalendarConnecting") : t("onboardingConnectCalendar")}
                  </Button>
                  <Button disabled={busy} type="button" variant="ghost" onClick={onSkipCalendar}>
                    {t("onboardingSkipCalendar")}
                  </Button>
                </div>
              </motion.div>
            ) : null}

            {step === "restore" ? (
              <motion.form
                key="restore"
                animate={{ opacity: 1, x: 0 }}
                className="grid gap-4"
                exit={{ opacity: 0, x: -12 }}
                initial={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.18 }}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (restoreReady && !busy) {
                    onRestore();
                  }
                }}
              >
                <StepHeader body={t("onboardingRestoreFormBody")} title={t("onboardingRestoreFormTitle")} />
                <button
                  className="flex min-h-24 items-center justify-between gap-4 rounded-lg border border-dashed border-powder-blue-500/35 bg-ink-black-950 px-4 py-3 text-left transition hover:border-powder-blue-500 hover:bg-powder-blue-950/20"
                  type="button"
                  onClick={onPickBackup}
                >
                  <span>
                    <span className="block text-sm font-semibold text-white">{t("onboardingSelectBackup")}</span>
                    <span className="mt-1 block break-all text-xs leading-5 text-alabaster-grey-500">
                      {restoreForm.backupPath || t("onboardingNoBackupSelected")}
                    </span>
                  </span>
                  <UploadCloud aria-hidden="true" className="h-5 w-5 shrink-0 text-powder-blue-500" strokeWidth={1.6} />
                </button>
                <Input
                  placeholder={t("onboardingBackupPassword")}
                  type="password"
                  value={restoreForm.password}
                  onChange={(event) => onRestoreFormChange({ ...restoreForm, password: event.target.value })}
                />
                <Button disabled={!restoreReady || busy} type="submit">
                  <RotateCcw aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
                  {busy ? t("onboardingRestoring") : t("onboardingStartRestore")}
                </Button>
              </motion.form>
            ) : null}
          </AnimatePresence>
          {statusMessage ? <p className="mt-4 rounded-md border border-alabaster-grey-500/15 bg-ink-black-950 p-3 text-xs leading-5 text-alabaster-grey-500">{statusMessage}</p> : null}
        </div>

        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-alabaster-grey-500/15 bg-glaucous-950/95 p-4 backdrop-blur">
          {step === "choice" ? (
            <span className="text-xs text-alabaster-grey-500">{t("onboardingSelectRequired")}</span>
          ) : (
            <Button disabled={busy || step === "calendar"} type="button" variant="ghost" onClick={onBack}>
              <ArrowLeft aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
              {t("onboardingBack")}
            </Button>
          )}
          {step === "choice" ? (
            <Button disabled={!choice} type="button" onClick={onContinue}>
              {t("onboardingContinue")}
            </Button>
          ) : step === "calendar" ? (
            <span className="inline-flex items-center gap-2 rounded-md border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-200">
              <CheckCircle2 aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
              {t("onboardingAdminReady")}
            </span>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function OnboardingChoiceCard({ active, body, icon, title, onClick }: { active: boolean; body: string; icon: ReactNode; title: string; onClick: () => void }) {
  return (
    <motion.button
      animate={{ scale: active ? 1.01 : 1 }}
      className={`min-h-48 rounded-xl border p-5 text-left transition ${
        active
          ? "border-powder-blue-500 bg-powder-blue-950/35 shadow-[0_0_0_1px_rgba(147,197,253,0.25),0_0_28px_rgba(59,130,246,0.22)]"
          : "border-alabaster-grey-500/20 bg-ink-black-950 hover:border-powder-blue-500/55 hover:bg-powder-blue-950/15"
      }`}
      type="button"
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
    >
      <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg border border-powder-blue-500/25 bg-glaucous-950 text-powder-blue-500">
        {icon}
      </span>
      <span className="block text-lg font-semibold text-white">{title}</span>
      <span className="mt-3 block text-sm leading-6 text-alabaster-grey-500">{body}</span>
    </motion.button>
  );
}

function StepHeader({ body, title }: { body: string; title: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-alabaster-grey-500">{body}</p>
    </div>
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
