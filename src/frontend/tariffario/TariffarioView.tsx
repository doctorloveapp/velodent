import { ArrowDown, ArrowUp, ClipboardList, Plus, Save } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/frontend/shared/ui/badge";
import { Button } from "@/frontend/shared/ui/button";
import { Input } from "@/frontend/shared/ui/input";
import { useL10n } from "@/frontend/shared/i18n/L10nProvider";
import {
  clinicalServiceGroupKey,
  clinicalServiceGroupLabelKey,
  clinicalServiceGroupOrder,
  type ClinicalServiceGroupKey
} from "@/frontend/clinical/serviceCategories";
import {
  isTauriRuntime,
  listClinicalServicesCatalog,
  reorderClinicalService,
  upsertClinicalService,
  type ClinicalService,
  type User
} from "@/frontend/settings/settingsApi";

interface TariffarioViewProps {
  currentUser: User | null;
}

interface ServiceDraft {
  code: string;
  name: string;
  basePrice: string;
  active: boolean;
}

interface NewServiceDraft {
  code: string;
  name: string;
  basePrice: string;
}

export function TariffarioView({ currentUser }: TariffarioViewProps) {
  const { t } = useL10n();
  const [services, setServices] = useState<ClinicalService[]>([]);
  const [drafts, setDrafts] = useState<Record<number, ServiceDraft>>({});
  const [newDrafts, setNewDrafts] = useState<Record<string, NewServiceDraft>>({});
  const [statusMessage, setStatusMessage] = useState("");
  const backendAvailable = isTauriRuntime();

  const groupedServices = useMemo(() => {
    const groups = new Map<ClinicalServiceGroupKey, ClinicalService[]>();
    for (const service of [...services].sort(compareServices)) {
      const group = clinicalServiceGroupKey(service.category);
      groups.set(group, [...(groups.get(group) ?? []), service]);
    }
    return [...groups.entries()].sort(
      ([left], [right]) => clinicalServiceGroupOrder.indexOf(left) - clinicalServiceGroupOrder.indexOf(right)
    );
  }, [services]);

  async function refreshServices() {
    if (!currentUser?.session_token) {
      return;
    }
    const nextServices = await listClinicalServicesCatalog(currentUser.session_token);
    setServices(nextServices);
    setDrafts(Object.fromEntries(nextServices.map((service) => [service.id, serviceToDraft(service)])));
  }

  useEffect(() => {
    void refreshServices().catch((error: unknown) => {
      setStatusMessage(error instanceof Error ? error.message : t("settingsGenericError"));
    });
  }, [currentUser?.session_token]);

  async function handleSave(service: ClinicalService) {
    if (!currentUser?.session_token) {
      setStatusMessage(t("settingsLoginRequired"));
      return;
    }
    const draft = drafts[service.id] ?? serviceToDraft(service);
    await upsertClinicalService({
      session_token: currentUser.session_token,
      service_id: service.id,
      code: draft.code,
      name: draft.name,
      category: service.category ?? undefined,
      base_price_cents: euroInputToCents(draft.basePrice),
      sort_order: service.sort_order,
      active: draft.active
    });
    setStatusMessage(t("settingsServiceSaved"));
    await refreshServices();
  }

  async function handleMove(group: ClinicalServiceGroupKey, service: ClinicalService, direction: -1 | 1) {
    if (!currentUser?.session_token) {
      setStatusMessage(t("settingsLoginRequired"));
      return;
    }
    const rows = services
      .filter((item) => clinicalServiceGroupKey(item.category) === group)
      .sort(compareServices);
    const index = rows.findIndex((item) => item.id === service.id);
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= rows.length) {
      return;
    }
    const target = rows[targetIndex];
    const previousServices = services;
    setServices((current) =>
      reorderGroupServicesOptimistically(current, group, service.id, target.id)
    );
    try {
      await reorderClinicalService({
        session_token: currentUser.session_token,
        service_id: service.id,
        target_service_id: target.id
      });
      setStatusMessage(t("settingsServiceReordered"));
      await refreshServices();
    } catch (error) {
      setServices(previousServices);
      throw error;
    }
  }

  async function handleCreate(group: ClinicalServiceGroupKey) {
    if (!currentUser?.session_token) {
      setStatusMessage(t("settingsLoginRequired"));
      return;
    }
    const draft = newDrafts[group] ?? emptyNewServiceDraft();
    const groupRows = services.filter((service) => clinicalServiceGroupKey(service.category) === group);
    const maxSort = Math.max(0, ...groupRows.map((service) => service.sort_order));
    await upsertClinicalService({
      session_token: currentUser.session_token,
      code: draft.code,
      name: draft.name,
      category: defaultCategoryForGroup(group),
      base_price_cents: euroInputToCents(draft.basePrice),
      sort_order: maxSort + 10,
      active: true
    });
    setNewDrafts((current) => ({ ...current, [group]: emptyNewServiceDraft() }));
    setStatusMessage(t("settingsServiceCreated"));
    await refreshServices();
  }

  if (!backendAvailable) {
    return (
      <TariffarioSurface>
        <p className="text-sm text-alabaster-grey-500">{t("settingsTauriUnavailable")}</p>
      </TariffarioSurface>
    );
  }

  return (
    <TariffarioSurface statusMessage={statusMessage}>
      <div className="grid gap-4">
        {groupedServices.map(([group, rows]) => {
          const newDraft = newDrafts[group] ?? emptyNewServiceDraft();
          return (
            <section key={group} className={`rounded-xl border p-3 ${categoryBlockClass(group)}`}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-white/60">{t("settingsServiceCategory")}</p>
                  <h3 className="text-base font-semibold text-white">{t(clinicalServiceGroupLabelKey(group))}</h3>
                </div>
                <Badge variant="default">{String(rows.length)}</Badge>
              </div>
              <div className="grid gap-2">
                {rows.map((service, index) => {
                  const draft = drafts[service.id] ?? serviceToDraft(service);
                  return (
                    <div
                      key={service.id}
                      className="grid items-center gap-2 rounded-md border border-alabaster-grey-500/15 bg-ink-black-950/85 p-2 xl:grid-cols-[74px_130px_minmax(220px,1fr)_120px_110px_auto]"
                    >
                      <div className="flex items-center gap-1">
                        <Button
                          aria-label={t("tariffarioMoveUp")}
                          disabled={index === 0}
                          size="icon"
                          type="button"
                          variant="secondary"
                          onClick={() => void handleMove(group, service, -1).catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("settingsGenericError")))}
                        >
                          <ArrowUp aria-hidden="true" className="h-4 w-4" />
                        </Button>
                        <Button
                          aria-label={t("tariffarioMoveDown")}
                          disabled={index === rows.length - 1}
                          size="icon"
                          type="button"
                          variant="secondary"
                          onClick={() => void handleMove(group, service, 1).catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("settingsGenericError")))}
                        >
                          <ArrowDown aria-hidden="true" className="h-4 w-4" />
                        </Button>
                      </div>
                      <Input value={draft.code} onChange={(event) => setDrafts((current) => ({ ...current, [service.id]: { ...draft, code: event.target.value } }))} />
                      <Input value={draft.name} onChange={(event) => setDrafts((current) => ({ ...current, [service.id]: { ...draft, name: event.target.value } }))} />
                      <Input min={0} step="0.01" type="number" value={draft.basePrice} onChange={(event) => setDrafts((current) => ({ ...current, [service.id]: { ...draft, basePrice: event.target.value } }))} />
                      <ServiceActiveSelect value={draft.active} onChange={(active) => setDrafts((current) => ({ ...current, [service.id]: { ...draft, active } }))} />
                      <Button type="button" variant="secondary" onClick={() => void handleSave(service).catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("settingsGenericError")))}>
                        <Save aria-hidden="true" className="h-4 w-4" />
                        {t("settingsServiceSave")}
                      </Button>
                    </div>
                  );
                })}
                <div className="grid items-center gap-2 rounded-md border border-dashed border-alabaster-grey-500/20 bg-ink-black-950/55 p-2 xl:grid-cols-[130px_minmax(220px,1fr)_120px_auto]">
                  <Input placeholder={t("settingsServiceCode")} value={newDraft.code} onChange={(event) => setNewDrafts((current) => ({ ...current, [group]: { ...newDraft, code: event.target.value } }))} />
                  <Input placeholder={t("settingsServiceName")} value={newDraft.name} onChange={(event) => setNewDrafts((current) => ({ ...current, [group]: { ...newDraft, name: event.target.value } }))} />
                  <Input min={0} step="0.01" type="number" placeholder={t("settingsServicePrice")} value={newDraft.basePrice} onChange={(event) => setNewDrafts((current) => ({ ...current, [group]: { ...newDraft, basePrice: event.target.value } }))} />
                  <Button type="button" onClick={() => void handleCreate(group).catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("settingsGenericError")))}>
                    <Plus aria-hidden="true" className="h-4 w-4" />
                    {t("settingsServiceCreate")}
                  </Button>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </TariffarioSurface>
  );
}

function TariffarioSurface({ children, statusMessage }: { children: ReactNode; statusMessage?: string }) {
  const { t } = useL10n();
  return (
    <section className="grid gap-4">
      <div className="rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md border border-powder-blue-500/30 bg-powder-blue-950 text-powder-blue-500">
              <ClipboardList aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">{t("settingsServicesEyebrow")}</p>
              <h1 className="text-lg font-semibold text-white">{t("settingsServicesTitle")}</h1>
            </div>
          </div>
          {statusMessage ? <span className="text-sm text-alabaster-grey-500">{statusMessage}</span> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function ServiceActiveSelect({ onChange, value }: { onChange: (active: boolean) => void; value: boolean }) {
  const { t } = useL10n();
  return (
    <select
      className="h-10 rounded-md border border-alabaster-grey-500/20 bg-glaucous-950 px-3 text-sm text-white outline-none focus:border-powder-blue-500 focus:ring-2 focus:ring-powder-blue-500/20"
      value={value ? "active" : "inactive"}
      onChange={(event) => onChange(event.target.value === "active")}
    >
      <option value="active">{t("settingsActive")}</option>
      <option value="inactive">{t("settingsInactive")}</option>
    </select>
  );
}

function serviceToDraft(service: ClinicalService): ServiceDraft {
  return {
    active: service.active,
    basePrice: (service.base_price_cents / 100).toFixed(2),
    code: service.code,
    name: service.name
  };
}

function emptyNewServiceDraft(): NewServiceDraft {
  return {
    basePrice: "0.00",
    code: "",
    name: ""
  };
}

function compareServices(left: ClinicalService, right: ClinicalService) {
  const sortDelta = left.sort_order - right.sort_order;
  return sortDelta === 0 ? left.name.localeCompare(right.name) : sortDelta;
}

function reorderGroupServicesOptimistically(
  services: ClinicalService[],
  group: ClinicalServiceGroupKey,
  serviceId: number,
  targetServiceId: number
) {
  const groupRows = services
    .filter((item) => clinicalServiceGroupKey(item.category) === group)
    .sort(compareServices);
  const serviceIndex = groupRows.findIndex((item) => item.id === serviceId);
  const targetIndex = groupRows.findIndex((item) => item.id === targetServiceId);
  if (serviceIndex < 0 || targetIndex < 0) {
    return services;
  }
  groupRows.splice(targetIndex, 0, ...groupRows.splice(serviceIndex, 1));
  const nextSortOrderById = new Map(groupRows.map((item, index) => [item.id, (index + 1) * 10]));
  return services.map((item) => {
    const nextSortOrder = nextSortOrderById.get(item.id);
    return nextSortOrder === undefined ? item : { ...item, sort_order: nextSortOrder };
  });
}

function categoryBlockClass(group: ClinicalServiceGroupKey) {
  if (group === "conservative") {
    return "border-emerald-400/35 bg-emerald-400/8";
  }
  if (group === "endodontics") {
    return "border-violet-400/35 bg-violet-400/8";
  }
  if (group === "periodontics") {
    return "border-sky-400/35 bg-sky-400/8";
  }
  if (group === "prosthesis") {
    return "border-amber-400/35 bg-amber-400/8";
  }
  if (group === "surgery") {
    return "border-red-500/35 bg-red-500/8";
  }
  if (group === "hygiene") {
    return "border-teal-300/35 bg-teal-300/8";
  }
  if (group === "orthodontics") {
    return "border-powder-blue-500/35 bg-powder-blue-500/8";
  }
  return "border-powder-blue-500/25 bg-glaucous-950";
}

function defaultCategoryForGroup(group: ClinicalServiceGroupKey) {
  if (group === "diagnosis") {
    return "diagnosi e piano di trattamento";
  }
  if (group === "hygiene") {
    return "igiene e profilassi";
  }
  if (group === "conservative") {
    return "conservativa";
  }
  if (group === "endodontics") {
    return "endodonzia";
  }
  if (group === "periodontics") {
    return "chirurgia parodontale";
  }
  if (group === "prosthesis") {
    return "protesi fissa";
  }
  if (group === "surgery") {
    return "chirurgia orale";
  }
  if (group === "orthodontics") {
    return "ortodonzia";
  }
  return "altro";
}

function euroInputToCents(value: string) {
  const parsed = Number.parseFloat(value.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.round(parsed * 100);
}
