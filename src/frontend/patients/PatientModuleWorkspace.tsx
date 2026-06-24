import { Braces, CircleDollarSign, Images, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { BillingPanel, RxPanel } from "@/frontend/patients/PatientsView";
import { openPatientRecord, searchPatients, type Patient } from "@/frontend/patients/patientsApi";
import { useL10n } from "@/frontend/shared/i18n/L10nProvider";
import { Input } from "@/frontend/shared/ui/input";
import type { User } from "@/frontend/settings/settingsApi";

interface PatientModuleWorkspaceProps {
  currentUser: User;
  module: "rx" | "billing" | "orthodontics";
  selectedPatient: Patient | null;
  onPatientSelected: (patient: Patient | null) => void;
}

export function PatientModuleWorkspace({ currentUser, module, onPatientSelected, selectedPatient }: PatientModuleWorkspaceProps) {
  const { t } = useL10n();
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [statusMessage, setStatusMessage] = useState("");

  async function handleSearch(nextQuery: string) {
    setQuery(nextQuery);
    setPatients(await searchPatients(currentUser.session_token ?? "", nextQuery, 20));
  }

  async function openPatient(patientId: number) {
    const opened = await openPatientRecord(currentUser.session_token ?? "", patientId);
    onPatientSelected(opened);
    setStatusMessage(t("patientsRecordOpened"));
  }

  useEffect(() => {
    void handleSearch("").catch(() => undefined);
  }, [currentUser.session_token]);

  const Icon = module === "rx" ? Images : module === "orthodontics" ? Braces : CircleDollarSign;
  const title = module === "rx" ? t("rxWorkspaceTitle") : module === "orthodontics" ? t("orthodonticsWorkspaceTitle") : t("billingWorkspaceTitle");
  const eyebrow = module === "rx" ? t("rxWorkspaceEyebrow") : module === "orthodontics" ? t("orthodonticsWorkspaceEyebrow") : t("billingWorkspaceEyebrow");

  return (
    <section className="grid gap-4">
      <div className="rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md border border-powder-blue-500/30 bg-powder-blue-950 text-powder-blue-500">
              <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">{eyebrow}</p>
              <h1 className="text-lg font-semibold text-white">{title}</h1>
            </div>
          </div>
          {statusMessage ? <span className="text-sm text-alabaster-grey-500">{statusMessage}</span> : null}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className="rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-4">
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-alabaster-grey-500" />
            <Input
              className="pl-9"
              placeholder={t("patientsSearchPlaceholder")}
              type="search"
              value={query}
              onChange={(event) => void handleSearch(event.target.value).catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("patientsGenericError")))}
            />
          </div>
          <div className="mt-3 grid max-h-[620px] gap-2 overflow-y-auto">
            {patients.map((patient) => (
              <button
                key={patient.id}
                className={[
                  "rounded-md border p-3 text-left transition",
                  selectedPatient?.id === patient.id
                    ? "border-amber-400/70 bg-amber-400/15 shadow-[0_0_24px_rgba(251,191,36,0.16)]"
                    : "border-alabaster-grey-500/20 bg-ink-black-950 hover:border-powder-blue-500/55"
                ].join(" ")}
                type="button"
                onClick={() => void openPatient(patient.id).catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("patientsGenericError")))}
              >
                <span className="block text-sm font-semibold text-white">{patient.last_name} {patient.first_name}</span>
                <span className="mt-1 block font-mono text-[11px] text-alabaster-grey-500">{patient.tax_code}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-4">
          {selectedPatient ? (
            module === "rx" ? (
              <RxPanel currentUser={currentUser} patient={selectedPatient} />
            ) : module === "orthodontics" ? (
              <OrthodonticsPanel patient={selectedPatient} />
            ) : (
              <BillingPanel currentUser={currentUser} patient={selectedPatient} />
            )
          ) : (
            <p className="text-sm text-alabaster-grey-500">{t("patientsRecordEmpty")}</p>
          )}
        </section>
      </div>
    </section>
  );
}

function OrthodonticsPanel({ patient }: { patient: Patient }) {
  const { t } = useL10n();
  return (
    <div className="grid gap-4">
      <div className="rounded-md border border-powder-blue-500/20 bg-powder-blue-950/35 p-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">{t("orthodonticsFolderEyebrow")}</p>
        <h2 className="mt-2 text-lg font-semibold text-white">{patient.last_name} {patient.first_name}</h2>
        <p className="mt-3 text-sm leading-6 text-alabaster-grey-500">{t("orthodonticsFolderBody")}</p>
      </div>
    </div>
  );
}
