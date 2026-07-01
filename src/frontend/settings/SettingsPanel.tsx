import { CalendarCheck, FileText, Laptop, Save, ShieldCheck, SlidersHorizontal, Trash2, UserPlus, UsersRound, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useL10n } from "@/frontend/shared/i18n/L10nProvider";
import type { L10nKey } from "@/frontend/shared/i18n/translations";
import { Badge } from "@/frontend/shared/ui/badge";
import { Button } from "@/frontend/shared/ui/button";
import { Input } from "@/frontend/shared/ui/input";
import { googleCalendarSyncStatus, type GoogleCalendarSyncStatus } from "@/frontend/agenda/agendaApi";
import { LicenseActivationEasterEgg } from "@/frontend/license/LicenseActivationEasterEgg";
import {
  listConsentTemplates,
  updateConsentTemplate,
  type ConsentTemplate
} from "@/frontend/consents/consentsApi";
import {
  changeAdminPassword,
  createEncryptedBackup,
  createUser,
  deleteUser,
  getPairingCode,
  getStudioSettings,
  isTauriRuntime,
  listGoogleCalendarAccounts,
  listDevices,
  listUsers,
  pickStudioLogoPath,
  removeGoogleAccount,
  restoreEncryptedBackup,
  revokeDevice,
  startGoogleCalendarAccountLink,
  updateStudioSettings,
  type AuthorizedDevice,
  type GoogleCalendarAccount,
  type PairingCodeInfo,
  type Role,
  type StudioSettings,
  type User
} from "./settingsApi";

const roleOptions: Role[] = ["admin", "odontoiatra", "aso"];

interface SettingsPanelProps {
  currentUser: User | null;
}

export function SettingsPanel({ currentUser }: SettingsPanelProps) {
  const { t } = useL10n();
  const [backendAvailable] = useState(isTauriRuntime());
  const [users, setUsers] = useState<User[]>([]);
  const [calendarAccounts, setCalendarAccounts] = useState<GoogleCalendarAccount[]>([]);
  const [calendarSyncStatus, setCalendarSyncStatus] = useState<GoogleCalendarSyncStatus | null>(null);
  const [devices, setDevices] = useState<AuthorizedDevice[]>([]);
  const [consentTemplates, setConsentTemplates] = useState<ConsentTemplate[]>([]);
  const [consentDrafts, setConsentDrafts] = useState<Record<number, { title: string; body: string; active: boolean }>>({});
  const [settings, setSettings] = useState<StudioSettings | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [backupStatusMessage, setBackupStatusMessage] = useState("");
  const [calendarLinking, setCalendarLinking] = useState(false);
  const [pairingCode, setPairingCode] = useState<PairingCodeInfo | null>(null);
  const [pairingQrDataUrl, setPairingQrDataUrl] = useState("");

  const [studioForm, setStudioForm] = useState({
    clinicName: "",
    logoRelativePath: "",
    chairCount: "1",
    dataDirectory: "",
    holidayPeriodsJson: "[]"
  });
  const [userForm, setUserForm] = useState({
    username: "",
    password: "",
    role: "aso" as Role
  });
  const [passwordForm, setPasswordForm] = useState({
    oldPassword: "",
    newPassword: "",
    confirmPassword: ""
  });
  const [backupPassword, setBackupPassword] = useState("");
  const activeDevices = devices.filter((device) => !device.revoked_at);
  const activeUsers = users.filter((user) => user.active);
  const calendarStatusKey = calendarSyncStatusKey(calendarSyncStatus);
  const calendarStatusVariant = calendarSyncStatusVariant(calendarSyncStatus);
  const principalAdminId = activeUsers
    .filter((user) => user.role === "admin")
    .map((user) => user.id)
    .sort((left, right) => left - right)[0];

  async function refresh() {
    if (!backendAvailable) {
      return;
    }
    if (!currentUser?.session_token) {
      setStatusMessage(t("settingsLoginRequired"));
      return;
    }

    const [nextUsers, nextCalendarAccounts, nextDevices, nextSettings, nextCalendarSyncStatus, nextConsentTemplates] = await Promise.all([
      listUsers(currentUser.session_token),
      listGoogleCalendarAccounts(currentUser.session_token),
      listDevices(currentUser.session_token),
      getStudioSettings(currentUser.session_token),
      googleCalendarSyncStatus(currentUser.session_token),
      listConsentTemplates(currentUser.session_token)
    ]);

    setUsers(nextUsers);
    setCalendarAccounts(nextCalendarAccounts);
    setCalendarSyncStatus(nextCalendarSyncStatus);
    setDevices(nextDevices);
    setConsentTemplates(nextConsentTemplates);
    setConsentDrafts(Object.fromEntries(nextConsentTemplates.map((template) => [
      template.id,
      { title: template.title, body: template.body, active: template.active }
    ])));
    setSettings(nextSettings);
    setStudioForm({
      clinicName: nextSettings.clinic_name ?? "",
      logoRelativePath: nextSettings.logo_relative_path ?? "",
      chairCount: String(nextSettings.chair_count),
      dataDirectory: nextSettings.data_directory ?? "",
      holidayPeriodsJson: nextSettings.holiday_periods_json
    });
  }

  useEffect(() => {
    void refresh().catch((error: unknown) => {
      setStatusMessage(error instanceof Error ? error.message : t("settingsGenericError"));
    });
  }, [currentUser?.session_token]);

  useEffect(() => {
    let cancelled = false;
    const publicUrl = pairingCode?.public_url;
    if (!publicUrl) {
      setPairingQrDataUrl("");
      return;
    }

    void QRCode.toDataURL(publicUrl, {
      color: {
        dark: "#070f1c",
        light: "#f4f7fb"
      },
      errorCorrectionLevel: "M",
      margin: 1,
      scale: 6
    })
      .then((dataUrl) => {
        if (!cancelled) {
          setPairingQrDataUrl(dataUrl);
        }
      })
      .catch((error: unknown) => {
        console.error("VeloDent pairing QR generation error:", error);
        if (!cancelled) {
          setPairingQrDataUrl("");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pairingCode?.public_url]);

  useEffect(() => {
    if (!pairingCode || !currentUser?.session_token) {
      return;
    }

    const sessionToken = currentUser.session_token;
    const interval = window.setInterval(() => {
      void listDevices(sessionToken).then(setDevices).catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(interval);
  }, [currentUser?.session_token, pairingCode]);

  if (!backendAvailable) {
    return (
      <SettingsSurface
        icon={<ShieldCheck aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />}
        title={t("settingsTitle")}
        eyebrow={t("settingsEyebrow")}
      >
        <p className="text-sm text-alabaster-grey-500">{t("settingsTauriUnavailable")}</p>
      </SettingsSurface>
    );
  }

  async function handleUpdateStudio() {
    if (!currentUser?.session_token) {
      setStatusMessage(t("settingsLoginRequired"));
      return;
    }

    const updated = await updateStudioSettings({
      session_token: currentUser.session_token,
      clinic_name: studioForm.clinicName || undefined,
      logo_relative_path: studioForm.logoRelativePath || undefined,
      chair_count: Number(studioForm.chairCount),
      data_directory: studioForm.dataDirectory || undefined,
      holiday_periods_json: studioForm.holidayPeriodsJson
    });
    setSettings(updated);
    setStatusMessage(t("settingsSaved"));
    await refresh();
  }

  async function handlePickLogoPath() {
    if (!currentUser?.session_token) {
      setStatusMessage(t("settingsLoginRequired"));
      return;
    }
    const path = await pickStudioLogoPath(currentUser.session_token);
    if (path) {
      setStudioForm((current) => ({ ...current, logoRelativePath: path }));
    }
  }

  async function handleCreateUser() {
    if (!currentUser?.session_token) {
      setStatusMessage(t("settingsLoginRequired"));
      return;
    }

    await createUser({
      session_token: currentUser.session_token,
      username: userForm.username,
      password: userForm.password || undefined,
      role: userForm.role
    });
    setUserForm({ username: "", password: "", role: "aso" });
    setStatusMessage(t("settingsUserCreated"));
    await refresh();
  }

  async function handleDeleteUser(userId: number) {
    if (!currentUser?.session_token) {
      setStatusMessage(t("settingsLoginRequired"));
      return;
    }
    if (!window.confirm(t("settingsDeleteUserConfirm"))) {
      return;
    }
    await deleteUser({ session_token: currentUser.session_token, user_id: userId });
    setStatusMessage(t("settingsUserDeleted"));
    await refresh();
  }

  async function handleChangeAdminPassword() {
    if (!currentUser?.session_token) {
      setStatusMessage(t("settingsLoginRequired"));
      return;
    }
    if (!passwordForm.oldPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      setStatusMessage(t("settingsPasswordRequired"));
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setStatusMessage(t("settingsPasswordMismatch"));
      return;
    }

    await changeAdminPassword({
      session_token: currentUser.session_token,
      old_password: passwordForm.oldPassword,
      new_password: passwordForm.newPassword
    });
    setPasswordForm({ oldPassword: "", newPassword: "", confirmPassword: "" });
    setStatusMessage(t("settingsPasswordChanged"));
  }

  async function handleCreateEncryptedBackup() {
    if (!currentUser?.session_token) {
      setStatusMessage(t("settingsLoginRequired"));
      return;
    }
    if (!backupPassword.trim()) {
      setStatusMessage(t("settingsBackupPasswordRequired"));
      setBackupStatusMessage(t("settingsBackupPasswordRequired"));
      return;
    }
    setBackupStatusMessage("");
    const result = await createEncryptedBackup(currentUser.session_token, backupPassword);
    setBackupPassword("");
    setStatusMessage(`${t("settingsBackupCreated")}: ${result.backup_path}`);
    setBackupStatusMessage(t("settingsBackupCreated"));
  }

  async function handleRestoreEncryptedBackup() {
    if (!currentUser?.session_token) {
      setStatusMessage(t("settingsLoginRequired"));
      return;
    }
    if (!backupPassword.trim()) {
      setStatusMessage(t("settingsBackupPasswordRequired"));
      setBackupStatusMessage(t("settingsBackupPasswordRequired"));
      return;
    }
    if (!window.confirm(t("settingsRestoreConfirm"))) {
      return;
    }
    setBackupStatusMessage("");
    await restoreEncryptedBackup(currentUser.session_token, backupPassword);
    setBackupPassword("");
    setStatusMessage(t("settingsRestoreCompleted"));
    setBackupStatusMessage(t("settingsRestoreCompleted"));
  }

  async function handleLinkGoogleCalendar() {
    if (!currentUser?.session_token) {
      setStatusMessage(t("settingsLoginRequired"));
      return;
    }

    setCalendarLinking(true);
    setStatusMessage(t("settingsCalendarAccountLinking"));
    try {
      await startGoogleCalendarAccountLink(currentUser.session_token);
      setStatusMessage(t("settingsCalendarAccountLinked"));
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusMessage(message.includes("oauth callback timed out") ? t("settingsCalendarAccountLinkTimeout") : t("settingsCalendarAccountLinkFailed"));
    } finally {
      setCalendarLinking(false);
    }
  }

  async function handleRemoveGoogleCalendarAccount(accountId: number) {
    if (!currentUser?.session_token) {
      setStatusMessage(t("settingsLoginRequired"));
      return;
    }

    await removeGoogleAccount(currentUser.session_token, accountId);
    setStatusMessage(t("settingsCalendarAccountRemoved"));
    await refresh();
  }

  async function handleGetPairingCode() {
    if (!currentUser?.session_token) {
      setStatusMessage(t("settingsLoginRequired"));
      return;
    }
    const nextPairingCode = await getPairingCode(currentUser.session_token);
    setPairingCode(nextPairingCode);
    setStatusMessage(t("settingsConnectSmartphone"));
  }

  async function handleRevokeDevice(deviceId: number) {
    if (!currentUser?.session_token) {
      setStatusMessage(t("settingsLoginRequired"));
      return;
    }

    await revokeDevice({ session_token: currentUser.session_token, device_id: deviceId });
    setStatusMessage(t("settingsDeviceRevoked"));
    await refresh();
  }

  async function handleUpdateConsentTemplate(templateId: number) {
    if (!currentUser?.session_token) {
      setStatusMessage(t("settingsLoginRequired"));
      return;
    }
    const draft = consentDrafts[templateId];
    if (!draft) {
      setStatusMessage(t("settingsGenericError"));
      return;
    }
    await updateConsentTemplate({
      session_token: currentUser.session_token,
      template_id: templateId,
      title: draft.title,
      body: draft.body,
      active: draft.active
    });
    setStatusMessage(t("settingsConsentTemplateSaved"));
    await refresh();
  }

  return (
    <div className="grid gap-4">
      <SettingsSurface
        icon={<SlidersHorizontal aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />}
        title={t("settingsTitle")}
        eyebrow={t("settingsEyebrow")}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={currentUser ? "success" : "warning"}>
            {currentUser ? `${t("settingsSessionActive")}: ${currentUser.username}` : t("settingsSessionMissing")}
          </Badge>
          {statusMessage ? <span className="text-sm text-alabaster-grey-500">{statusMessage}</span> : null}
        </div>
      </SettingsSurface>

      <SettingsSurface
        icon={<SlidersHorizontal aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />}
        title={t("settingsStudioTitle")}
        eyebrow={t("settingsStudioEyebrow")}
      >
        <DenseForm>
          <Input placeholder={t("settingsClinicName")} value={studioForm.clinicName} onChange={(event) => setStudioForm({ ...studioForm, clinicName: event.target.value })} />
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
            <Input placeholder={t("settingsLogoPath")} value={studioForm.logoRelativePath} onChange={(event) => setStudioForm({ ...studioForm, logoRelativePath: event.target.value })} />
            <SettingsActionButton size="sm" onClick={() => void handlePickLogoPath().catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("settingsGenericError")))}>
              {t("settingsPickLogo")}
            </SettingsActionButton>
          </div>
          <Input placeholder={t("settingsChairCount")} type="number" min={1} value={studioForm.chairCount} onChange={(event) => setStudioForm({ ...studioForm, chairCount: event.target.value })} />
          <SettingsActionButton onClick={() => void handleUpdateStudio()}>
            <Save aria-hidden="true" className="h-4 w-4" strokeWidth={1.6} />
            {t("settingsSaveStudio")}
          </SettingsActionButton>
        </DenseForm>
        <div className="mt-3 grid gap-1 text-xs leading-5 text-alabaster-grey-500">
          <p>{t("settingsLogoHelp")}</p>
        </div>
        {settings ? <p className="mt-3 text-xs text-alabaster-grey-500">{t("settingsCurrentChairs")}: {settings.chair_count}</p> : null}
      </SettingsSurface>

      <div className="grid gap-4 xl:grid-cols-2">
        <SettingsSurface
          icon={<UsersRound aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />}
          title={t("settingsUsersTitle")}
          eyebrow={t("settingsUsersEyebrow")}
        >
          <DenseForm>
            <Input placeholder={t("settingsUsername")} value={userForm.username} onChange={(event) => setUserForm({ ...userForm, username: event.target.value })} />
            <Input placeholder={t("settingsPasswordOptional")} type="password" value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} />
            <RoleSelect value={userForm.role} onChange={(role) => setUserForm({ ...userForm, role })} />
            <SettingsActionButton onClick={() => void handleCreateUser()}>
              <UserPlus aria-hidden="true" className="h-4 w-4" strokeWidth={1.6} />
              {t("settingsCreateUser")}
            </SettingsActionButton>
          </DenseForm>
          <DenseTable
            headers={[t("settingsUsername"), t("settingsRole"), t("settingsStatus"), t("settingsAction")]}
            rows={activeUsers.map((user) => [
              user.username,
              user.role,
              user.active ? t("settingsActive") : t("settingsInactive"),
              user.id === currentUser?.id || user.id === principalAdminId ? (
                <span key={user.id} className="text-xs text-alabaster-grey-500">-</span>
              ) : (
                <SettingsActionButton
                  key={user.id}
                  size="sm"
                  tone="danger"
                  onClick={() => void handleDeleteUser(user.id).catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("settingsGenericError")))}
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" strokeWidth={1.6} />
                  {t("settingsDeleteUser")}
                </SettingsActionButton>
              )
            ])}
          />
        </SettingsSurface>

        <SettingsSurface
          icon={<ShieldCheck aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />}
          title={t("settingsAdminPasswordTitle")}
          eyebrow={t("settingsAdminPasswordEyebrow")}
        >
          <DenseForm>
            <Input
              autoComplete="current-password"
              placeholder={t("settingsOldPassword")}
              type="password"
              value={passwordForm.oldPassword}
              onChange={(event) => setPasswordForm({ ...passwordForm, oldPassword: event.target.value })}
            />
            <Input
              autoComplete="new-password"
              placeholder={t("settingsNewPassword")}
              type="password"
              value={passwordForm.newPassword}
              onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })}
            />
            <Input
              autoComplete="new-password"
              placeholder={t("settingsConfirmPassword")}
              type="password"
              value={passwordForm.confirmPassword}
              onChange={(event) => setPasswordForm({ ...passwordForm, confirmPassword: event.target.value })}
            />
            <SettingsActionButton onClick={() => void handleChangeAdminPassword().catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("settingsGenericError")))}>
              <ShieldCheck aria-hidden="true" className="h-4 w-4" strokeWidth={1.6} />
              {t("settingsChangePassword")}
            </SettingsActionButton>
          </DenseForm>
        </SettingsSurface>

        <SettingsSurface
          icon={<ShieldCheck aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />}
          title={t("settingsBackupTitle")}
          eyebrow={t("settingsBackupEyebrow")}
        >
          <div className="grid gap-3">
            <p className="text-sm leading-6 text-alabaster-grey-500">{t("settingsBackupHelp")}</p>
            <Input
              autoComplete="current-password"
              placeholder={t("settingsBackupAdminPassword")}
              type="password"
              value={backupPassword}
              onChange={(event) => {
                setBackupPassword(event.target.value);
                if (backupStatusMessage) {
                  setBackupStatusMessage("");
                }
              }}
            />
            {backupStatusMessage ? (
              <p className="rounded-md border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-sm font-medium text-amber-100">
                {backupStatusMessage}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <SettingsActionButton onClick={() => void handleCreateEncryptedBackup().catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("settingsGenericError")))}>
                <Save aria-hidden="true" className="h-4 w-4" strokeWidth={1.6} />
                {t("settingsCreateBackup")}
              </SettingsActionButton>
              <SettingsActionButton tone="danger" onClick={() => void handleRestoreEncryptedBackup().catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("settingsGenericError")))}>
                <ShieldCheck aria-hidden="true" className="h-4 w-4" strokeWidth={1.6} />
                {t("settingsRestoreBackup")}
              </SettingsActionButton>
            </div>
          </div>
        </SettingsSurface>
      </div>

      <SettingsSurface
        icon={<CalendarCheck aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />}
        title={t("settingsGoogleCalendarAccountsTitle")}
        eyebrow={t("settingsGoogleCalendarAccountsEyebrow")}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-2">
            <p className="text-sm text-alabaster-grey-500">{t("settingsGoogleCalendarAccountsHelp")}</p>
            <Badge
              className="w-fit"
              variant={calendarStatusVariant}
            >
              {t(calendarStatusKey)}
            </Badge>
          </div>
          <SettingsActionButton disabled={calendarAccounts.length > 0 || calendarLinking} onClick={() => void handleLinkGoogleCalendar()}>
            <CalendarCheck aria-hidden="true" className="h-4 w-4" strokeWidth={1.6} />
            {calendarLinking ? t("settingsCalendarAccountLinking") : t("settingsGoogleCalendarAddAccount")}
          </SettingsActionButton>
        </div>
        <DenseTable
          headers={[t("settingsGoogleEmail"), t("settingsCalendarId"), t("settingsStatus"), t("settingsAction")]}
          rows={calendarAccounts.map((account) => [
            account.email ?? "-",
            account.calendar_id,
            <Badge key={account.id} variant={account.active ? "success" : "warning"}>
              {account.active ? t("agendaCalendarConnected") : t("agendaCalendarDisconnected")}
            </Badge>,
            <SettingsActionButton
              key={`remove-${String(account.id)}`}
              size="sm"
              tone="danger"
              onClick={() => void handleRemoveGoogleCalendarAccount(account.id).catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("settingsGenericError")))}
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" strokeWidth={1.6} />
              {t("settingsGoogleCalendarRemoveAccount")}
            </SettingsActionButton>
          ])}
        />
      </SettingsSurface>

      <SettingsSurface
        icon={<FileText aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />}
        title={t("settingsLegalTextsTitle")}
        eyebrow={t("settingsLegalTextsEyebrow")}
      >
        <details className="rounded-md border border-alabaster-grey-500/20 bg-ink-black-950">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-white">
            {t("settingsLegalTextsSummary")}
          </summary>
          <div className="grid gap-3 border-t border-alabaster-grey-500/20 p-3">
            <p className="text-sm leading-6 text-alabaster-grey-500">{t("settingsLegalTextsHelp")}</p>
            {consentTemplates.map((template) => {
              const draft = consentDrafts[template.id] ?? { title: template.title, body: template.body, active: template.active };
              return (
                <details key={template.id} className="rounded-md border border-alabaster-grey-500/20 bg-glaucous-950">
                  <summary className="cursor-pointer px-3 py-3 text-sm font-semibold text-white">
                    {template.title}
                  </summary>
                  <div className="grid gap-3 border-t border-alabaster-grey-500/20 p-3">
                    <Input
                      aria-label={t("settingsConsentTemplateTitle")}
                      value={draft.title}
                      onChange={(event) => setConsentDrafts((current) => ({
                        ...current,
                        [template.id]: { ...draft, title: event.target.value }
                      }))}
                    />
                    <textarea
                      aria-label={t("settingsConsentTemplateBody")}
                      className="min-h-64 w-full rounded-md border border-alabaster-grey-500/20 bg-ink-black-950 px-3 py-2 text-sm leading-6 text-white outline-none placeholder:text-alabaster-grey-500 focus:border-powder-blue-500 focus:ring-2 focus:ring-powder-blue-500/20"
                      value={draft.body}
                      onChange={(event) => setConsentDrafts((current) => ({
                        ...current,
                        [template.id]: { ...draft, body: event.target.value }
                      }))}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <label className="inline-flex items-center gap-2 text-sm text-alabaster-grey-500">
                        <input
                          checked={draft.active}
                          className="h-4 w-4 accent-powder-blue-500"
                          type="checkbox"
                          onChange={(event) => setConsentDrafts((current) => ({
                            ...current,
                            [template.id]: { ...draft, active: event.target.checked }
                          }))}
                        />
                        {t("settingsConsentTemplateActive")}
                      </label>
                      <SettingsActionButton onClick={() => void handleUpdateConsentTemplate(template.id).catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("settingsGenericError")))}>
                        <Save aria-hidden="true" className="h-4 w-4" strokeWidth={1.6} />
                        {t("settingsConsentTemplateSave")}
                      </SettingsActionButton>
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        </details>
      </SettingsSurface>

      <SettingsSurface
        icon={<Laptop aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />}
        title={t("settingsDevicesTitle")}
        eyebrow={t("settingsDevicesEyebrow")}
      >
        <div className="rounded-xl border border-powder-blue-500/25 bg-ink-black-950 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">
                {t("settingsConnectSmartphone")}
              </p>
              <p className="mt-1 text-xs text-alabaster-grey-500">{t("settingsPairingHelp")}</p>
            </div>
            <SettingsActionButton onClick={() => void handleGetPairingCode().catch(() => setStatusMessage(t("settingsGenericError")))}>
              <Wifi aria-hidden="true" className="h-4 w-4" strokeWidth={1.6} />
              {t("settingsConnectSmartphone")}
            </SettingsActionButton>
          </div>
          {pairingCode ? (
            <div className="mt-4 rounded-md border border-powder-blue-500/35 bg-powder-blue-950 p-4 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-alabaster-grey-500">
                {t("settingsPairingPin")}
              </p>
              <p className="mt-2 font-mono text-4xl font-semibold tracking-[0.22em] text-white">
                {pairingCode.code}
              </p>
              <p className="mt-2 text-xs text-alabaster-grey-500">
                {t("settingsPairingExpires")} - {t("settingsPairingLanPort")}: {pairingCode.server_port}
              </p>
              {pairingCode.public_url ? (
                <div className="mt-4 grid gap-3 rounded-md border border-emerald-400/25 bg-emerald-400/10 p-3 text-left md:grid-cols-[auto,1fr]">
                  {pairingQrDataUrl ? (
                    <div className="rounded-md border border-alabaster-grey-500/20 bg-alabaster-grey-500 p-2">
                      <img
                        alt={t("settingsPairingQrAlt")}
                        className="h-32 w-32"
                        src={pairingQrDataUrl}
                      />
                    </div>
                  ) : null}
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-200">
                      {t("settingsMobileLanUrl")}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-emerald-100">{t("settingsPairingQrHelp")}</p>
                    <p className="mt-2 break-all font-mono text-sm text-white">{displayPairingUrl(pairingCode.public_url)}</p>
                  </div>
                </div>
              ) : null}
              {pairingCode.tunnel_error ? (
                <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-left">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-red-200">{t("settingsMobileLanUnavailable")}</p>
                  <p className="mt-2 text-xs leading-5 text-red-100">{pairingCode.tunnel_error}</p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <DenseTable
          headers={[t("settingsDeviceLabel"), t("settingsUserId"), t("settingsLanCidr"), t("settingsStatus"), t("settingsAction")]}
          rows={activeDevices.map((device) => [
            device.label,
            device.user_id ? String(device.user_id) : "-",
            device.allowed_lan_cidr ?? "-",
            t("settingsActive"),
            <SettingsActionButton key={device.id} tone="danger" size="sm" onClick={() => void handleRevokeDevice(device.id)}>
              <Trash2 aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.6} />
              {t("settingsRevoke")}
            </SettingsActionButton>
          ])}
        />
      </SettingsSurface>

      <SettingsSurface
        icon={<ShieldCheck aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />}
        title={t("settingsAboutTitle")}
        eyebrow={t("settingsAboutEyebrow")}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <LicenseActivationEasterEgg />
          <p className="text-sm font-medium text-alabaster-grey-500">{t("settingsOpenSourceLicenses")}</p>
        </div>
      </SettingsSurface>
    </div>
  );
}

function displayPairingUrl(publicUrl: string | null) {
  if (!publicUrl) {
    return "";
  }
  try {
    const url = new URL(publicUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "http://velodent.local:1420";
  }
}

function SettingsSurface({ children, eyebrow, icon, title }: { children: React.ReactNode; eyebrow: string; icon: React.ReactNode; title: string }) {
  return (
    <section className="rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-4">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md border border-powder-blue-500/30 bg-powder-blue-950 text-powder-blue-500">
          {icon}
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">{eyebrow}</p>
          <h2 className="text-base font-semibold text-white">{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

function calendarSyncStatusKey(status: GoogleCalendarSyncStatus | null): L10nKey {
  if (!status?.connected) {
    return "agendaCalendarDisconnected";
  }
  if (status.failed_jobs > 0) {
    return "agendaCalendarNeedsReview";
  }
  if (status.queued_jobs > 0) {
    return "agendaCalendarUpdating";
  }
  return "agendaCalendarConnected";
}

function calendarSyncStatusVariant(status: GoogleCalendarSyncStatus | null): "success" | "warning" | "danger" {
  if (!status?.connected) {
    return "warning";
  }
  if (status.failed_jobs > 0) {
    return "danger";
  }
  if (status.queued_jobs > 0) {
    return "warning";
  }
  return "success";
}

function DenseForm({ children }: { children: React.ReactNode }) {
  return <div className="grid items-center gap-2 md:grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">{children}</div>;
}

function SettingsActionButton({
  children,
  disabled = false,
  onClick,
  size = "default",
  tone = "primary"
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
  size?: "default" | "sm";
  tone?: "primary" | "danger";
}) {
  const baseClass = size === "sm"
    ? "h-9 min-w-[104px] gap-2 px-3 text-xs"
    : "h-10 min-w-[136px] gap-2 px-4 text-sm";
  const toneClass = tone === "danger"
    ? "border-red-500/35 bg-red-500/10 text-red-200 hover:border-red-400/60 hover:bg-red-500/20 hover:text-red-100 hover:shadow-[0_0_18px_rgba(239,68,68,0.18)]"
    : "border-powder-blue-500/35 bg-powder-blue-950/60 text-powder-blue-100 hover:border-powder-blue-400/60 hover:bg-powder-blue-500/20 hover:text-white hover:shadow-[0_0_20px_rgba(47,127,208,0.18)]";
  return (
    <Button
      disabled={disabled}
      type="button"
      variant="secondary"
      className={[
        baseClass,
        toneClass,
        disabled ? "cursor-not-allowed opacity-45 hover:shadow-none" : "",
        "w-fit justify-center justify-self-start whitespace-nowrap rounded-md font-semibold transition-[border-color,background-color,box-shadow,color]"
      ].join(" ")}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function RoleSelect({ onChange, value }: { onChange: (role: Role) => void; value: Role }) {
  const { t } = useL10n();

  return (
    <select
      className="h-10 rounded-md border border-alabaster-grey-500/20 bg-glaucous-950 px-3 text-sm text-white outline-none focus:border-powder-blue-500 focus:ring-2 focus:ring-powder-blue-500/20"
      value={value}
      onChange={(event) => onChange(event.target.value as Role)}
    >
      {roleOptions.map((role) => (
        <option key={role} value={role}>
          {t(role === "admin" ? "settingsRoleAdmin" : role === "odontoiatra" ? "settingsRoleDoctor" : "settingsRoleAso")}
        </option>
      ))}
    </select>
  );
}

function DenseTable({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="mt-4 overflow-hidden rounded-md border border-alabaster-grey-500/20">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-ink-black-950 text-[10px] uppercase tracking-widest text-alabaster-grey-500">
          <tr>
            {headers.map((header) => (
              <th key={header} className="border-b border-alabaster-grey-500/20 px-3 py-2 font-semibold">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-alabaster-grey-500/10 last:border-b-0">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-2 text-alabaster-grey-500">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
