import { ClipboardList, Laptop, Save, ShieldCheck, SlidersHorizontal, Trash2, UserPlus, UsersRound, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import { useL10n } from "@/frontend/shared/i18n/L10nProvider";
import { Badge } from "@/frontend/shared/ui/badge";
import { Button } from "@/frontend/shared/ui/button";
import { Input } from "@/frontend/shared/ui/input";
import {
  addAuthorizedGoogleAccount,
  authorizeDevice,
  createUser,
  getPairingCode,
  getStudioSettings,
  isTauriRuntime,
  listClinicalServices,
  listAuthorizedGoogleAccounts,
  listDevices,
  listUsers,
  revokeDevice,
  updateClinicalServicePrice,
  updateStudioSettings,
  type AuthorizedDevice,
  type AuthorizedGoogleAccount,
  type ClinicalService,
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
  const [googleAccounts, setGoogleAccounts] = useState<AuthorizedGoogleAccount[]>([]);
  const [devices, setDevices] = useState<AuthorizedDevice[]>([]);
  const [services, setServices] = useState<ClinicalService[]>([]);
  const [settings, setSettings] = useState<StudioSettings | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [oneTimeToken, setOneTimeToken] = useState("");
  const [pairingCode, setPairingCode] = useState<PairingCodeInfo | null>(null);

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
    googleEmail: "",
    role: "aso" as Role
  });
  const [googleForm, setGoogleForm] = useState({ email: "", role: "aso" as Role });
  const [deviceForm, setDeviceForm] = useState({ label: "", userId: "", allowedLanCidr: "" });

  async function refresh() {
    if (!backendAvailable) {
      return;
    }
    if (!currentUser?.session_token) {
      setStatusMessage(t("settingsLoginRequired"));
      return;
    }

    const [nextUsers, nextGoogleAccounts, nextDevices, nextSettings, nextServices] = await Promise.all([
      listUsers(currentUser.session_token),
      listAuthorizedGoogleAccounts(currentUser.session_token),
      listDevices(currentUser.session_token),
      getStudioSettings(currentUser.session_token),
      listClinicalServices(currentUser.session_token)
    ]);

    setUsers(nextUsers);
    setGoogleAccounts(nextGoogleAccounts);
    setDevices(nextDevices);
    setServices(nextServices);
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

  async function handleCreateUser() {
    if (!currentUser?.session_token) {
      setStatusMessage(t("settingsLoginRequired"));
      return;
    }

    await createUser({
      session_token: currentUser.session_token,
      username: userForm.username,
      password: userForm.password || undefined,
      google_email: userForm.googleEmail || undefined,
      role: userForm.role
    });
    setUserForm({ username: "", password: "", googleEmail: "", role: "aso" });
    setStatusMessage(t("settingsUserCreated"));
    await refresh();
  }

  async function handleAddGoogle() {
    if (!currentUser?.session_token) {
      setStatusMessage(t("settingsLoginRequired"));
      return;
    }

    await addAuthorizedGoogleAccount({
      session_token: currentUser.session_token,
      email: googleForm.email,
      role: googleForm.role
    });
    setGoogleForm({ email: "", role: "aso" });
    setStatusMessage(t("settingsGoogleAdded"));
    await refresh();
  }

  async function handleAuthorizeDevice() {
    if (!currentUser?.session_token) {
      setStatusMessage(t("settingsLoginRequired"));
      return;
    }

    const authorization = await authorizeDevice({
      session_token: currentUser.session_token,
      user_id: deviceForm.userId ? Number(deviceForm.userId) : undefined,
      label: deviceForm.label,
      allowed_lan_cidr: deviceForm.allowedLanCidr || undefined
    });
    setOneTimeToken(authorization.token_once);
    setDeviceForm({ label: "", userId: "", allowedLanCidr: "" });
    setStatusMessage(t("settingsDeviceAuthorized"));
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

  async function handleUpdateServicePrice(serviceId: number, basePriceCents: number) {
    if (!currentUser?.session_token) {
      setStatusMessage(t("settingsLoginRequired"));
      return;
    }

    const updated = await updateClinicalServicePrice({
      session_token: currentUser.session_token,
      service_id: serviceId,
      base_price_cents: basePriceCents
    });
    setServices((current) => current.map((service) => (service.id === updated.id ? updated : service)));
    setStatusMessage(t("settingsServiceSaved"));
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
          <Input placeholder={t("settingsLogoPath")} value={studioForm.logoRelativePath} onChange={(event) => setStudioForm({ ...studioForm, logoRelativePath: event.target.value })} />
          <Input placeholder={t("settingsChairCount")} type="number" min={1} value={studioForm.chairCount} onChange={(event) => setStudioForm({ ...studioForm, chairCount: event.target.value })} />
          <Input placeholder={t("settingsDataDirectory")} value={studioForm.dataDirectory} onChange={(event) => setStudioForm({ ...studioForm, dataDirectory: event.target.value })} />
          <Input placeholder={t("settingsHolidayJson")} value={studioForm.holidayPeriodsJson} onChange={(event) => setStudioForm({ ...studioForm, holidayPeriodsJson: event.target.value })} />
          <Button type="button" className="h-10 w-fit justify-center px-4 font-semibold shadow-[0_0_18px_rgba(47,127,208,0.14)] hover:shadow-[0_0_26px_rgba(47,127,208,0.24)]" onClick={() => void handleUpdateStudio()}>
            <Save aria-hidden="true" className="h-4 w-4" strokeWidth={1.6} />
            {t("settingsSaveStudio")}
          </Button>
        </DenseForm>
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
            <Input placeholder={t("settingsGoogleEmail")} value={userForm.googleEmail} onChange={(event) => setUserForm({ ...userForm, googleEmail: event.target.value })} />
            <RoleSelect value={userForm.role} onChange={(role) => setUserForm({ ...userForm, role })} />
            <Button type="button" className="h-10 w-fit justify-center px-4 font-semibold shadow-[0_0_18px_rgba(47,127,208,0.14)] hover:shadow-[0_0_26px_rgba(47,127,208,0.24)]" onClick={() => void handleCreateUser()}>
              <UserPlus aria-hidden="true" className="h-4 w-4" strokeWidth={1.6} />
              {t("settingsCreateUser")}
            </Button>
          </DenseForm>
          <DenseTable
            headers={[t("settingsUsername"), t("settingsRole"), t("settingsGoogleEmail"), t("settingsStatus")]}
            rows={users.map((user) => [user.username, user.role, user.google_email ?? "-", user.active ? t("settingsActive") : t("settingsInactive")])}
          />
        </SettingsSurface>

        <SettingsSurface
          icon={<ShieldCheck aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />}
          title={t("settingsGoogleTitle")}
          eyebrow={t("settingsSecurityEyebrow")}
        >
          <DenseForm>
            <Input placeholder={t("settingsGoogleEmail")} value={googleForm.email} onChange={(event) => setGoogleForm({ ...googleForm, email: event.target.value })} />
            <RoleSelect value={googleForm.role} onChange={(role) => setGoogleForm({ ...googleForm, role })} />
            <Button type="button" className="h-10 w-fit justify-center px-4 font-semibold shadow-[0_0_18px_rgba(47,127,208,0.14)] hover:shadow-[0_0_26px_rgba(47,127,208,0.24)]" onClick={() => void handleAddGoogle()}>
              <ShieldCheck aria-hidden="true" className="h-4 w-4" strokeWidth={1.6} />
              {t("settingsAuthorizeGoogle")}
            </Button>
          </DenseForm>
          <DenseTable
            headers={[t("settingsGoogleEmail"), t("settingsRole"), t("settingsStatus")]}
            rows={googleAccounts.map((account) => [account.email, account.role, account.active ? t("settingsActive") : t("settingsInactive")])}
          />
        </SettingsSurface>
      </div>

      <SettingsSurface
        icon={<Laptop aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />}
        title={t("settingsDevicesTitle")}
        eyebrow={t("settingsDevicesEyebrow")}
      >
        <DenseForm>
          <Input placeholder={t("settingsDeviceLabel")} value={deviceForm.label} onChange={(event) => setDeviceForm({ ...deviceForm, label: event.target.value })} />
          <Input placeholder={t("settingsDeviceUserId")} value={deviceForm.userId} onChange={(event) => setDeviceForm({ ...deviceForm, userId: event.target.value })} />
          <Input placeholder={t("settingsLanCidr")} value={deviceForm.allowedLanCidr} onChange={(event) => setDeviceForm({ ...deviceForm, allowedLanCidr: event.target.value })} />
          <Button type="button" className="h-10 w-fit justify-center px-4 font-semibold shadow-[0_0_18px_rgba(47,127,208,0.14)] hover:shadow-[0_0_26px_rgba(47,127,208,0.24)]" onClick={() => void handleAuthorizeDevice()}>
            <Laptop aria-hidden="true" className="h-4 w-4" strokeWidth={1.6} />
            {t("settingsAuthorizeDevice")}
          </Button>
        </DenseForm>
        {oneTimeToken ? (
          <div className="mt-3 rounded-md border border-powder-blue-500/30 bg-powder-blue-950 p-3 font-mono text-xs text-white">
            {t("settingsOneTimeToken")}: {oneTimeToken}
          </div>
        ) : null}
        <div className="mt-3 rounded-xl border border-powder-blue-500/25 bg-ink-black-950 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">
                {t("settingsConnectSmartphone")}
              </p>
              <p className="mt-1 text-xs text-alabaster-grey-500">{t("settingsPairingHelp")}</p>
            </div>
            <Button type="button" variant="secondary" className="h-10 w-fit justify-center px-4 shadow-[0_0_14px_rgba(47,127,208,0.10)] hover:shadow-[0_0_22px_rgba(47,127,208,0.18)]" onClick={() => void handleGetPairingCode().catch(() => setStatusMessage(t("settingsGenericError")))}>
              <Wifi aria-hidden="true" className="h-4 w-4" strokeWidth={1.6} />
              {t("settingsConnectSmartphone")}
            </Button>
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
            </div>
          ) : null}
        </div>
        <DenseTable
          headers={[t("settingsDeviceLabel"), t("settingsUserId"), t("settingsLanCidr"), t("settingsStatus"), t("settingsAction")]}
          rows={devices.map((device) => [
            device.label,
            device.user_id ? String(device.user_id) : "-",
            device.allowed_lan_cidr ?? "-",
            device.revoked_at ? t("settingsRevoked") : t("settingsActive"),
            device.revoked_at ? "-" : (
              <Button key={device.id} type="button" variant="secondary" size="sm" className="w-fit text-red-300 hover:bg-red-500/15 hover:text-red-100" onClick={() => void handleRevokeDevice(device.id)}>
                <Trash2 aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.6} />
                {t("settingsRevoke")}
              </Button>
            )
          ])}
        />
      </SettingsSurface>

      <SettingsSurface
        icon={<ClipboardList aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />}
        title={t("settingsServicesTitle")}
        eyebrow={t("settingsServicesEyebrow")}
      >
        <DenseTable
          headers={[t("settingsServiceCode"), t("settingsServiceName"), t("settingsServiceCategory"), t("settingsServicePrice"), t("settingsStatus")]}
          rows={services.map((service) => [
            service.code,
            service.name,
            service.category,
            <ServicePriceEditor
              key={`price-${String(service.id)}`}
              cents={service.base_price_cents}
              onSave={(nextCents) => void handleUpdateServicePrice(service.id, nextCents).catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("settingsGenericError")))}
            />,
            service.active ? t("settingsActive") : t("settingsInactive")
          ])}
        />
      </SettingsSurface>

      <SettingsSurface
        icon={<SlidersHorizontal aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />}
        title={t("settingsFutureTitle")}
        eyebrow={t("settingsFutureEyebrow")}
      >
        <div className="grid gap-3 md:grid-cols-3">
          {[t("settingsSumupPlaceholder"), t("settingsGoogleCalendarPlaceholder"), t("settingsRxDriverPlaceholder")].map((item) => (
            <div key={item} className="rounded-md border border-alabaster-grey-500/20 bg-ink-black-950 p-3 text-sm text-alabaster-grey-500">
              {item}
            </div>
          ))}
        </div>
      </SettingsSurface>
    </div>
  );
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

function DenseForm({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">{children}</div>;
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

function ServicePriceEditor({ cents, onSave }: { cents: number; onSave: (cents: number) => void }) {
  const { t } = useL10n();
  const [value, setValue] = useState(centsToEuroInput(cents));

  useEffect(() => {
    setValue(centsToEuroInput(cents));
  }, [cents]);

  return (
    <div className="flex min-w-[150px] items-center gap-2">
      <Input className="h-8 w-24" min={0} step="0.01" type="number" value={value} onChange={(event) => setValue(event.target.value)} />
      <Button type="button" variant="secondary" size="sm" className="w-fit shadow-[0_0_12px_rgba(47,127,208,0.10)] hover:shadow-[0_0_18px_rgba(47,127,208,0.18)]" onClick={() => onSave(euroInputToCents(value))}>
        <Save aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.6} />
        {t("settingsServiceSave")}
      </Button>
    </div>
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

function centsToEuroInput(cents: number) {
  return (cents / 100).toFixed(2);
}

function euroInputToCents(value: string) {
  const parsed = Number.parseFloat(value.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.round(parsed * 100);
}
