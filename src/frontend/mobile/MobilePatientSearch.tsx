import { Search } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { openPatientRecord, searchPatients, type Patient } from "@/frontend/patients/patientsApi";
import { useL10n } from "@/frontend/shared/i18n/L10nProvider";
import { Input } from "@/frontend/shared/ui/input";

interface MobilePatientSearchProps {
  sessionToken: string;
  onPatientSelect: (patient: Patient) => void;
}

export function MobilePatientSearch({ sessionToken, onPatientSelect }: MobilePatientSearchProps) {
  const { t } = useL10n();
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [statusMessage, setStatusMessage] = useState(t("mobileSearchPatientStart"));
  const [loadingPatientId, setLoadingPatientId] = useState<number | null>(null);

  useEffect(() => {
    if (!sessionToken) {
      return;
    }
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setPatients([]);
      setStatusMessage(t("mobileSearchPatientStart"));
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchPatients(sessionToken, trimmed, 20)
        .then((results) => {
          if (cancelled) {
            return;
          }
          setPatients(results);
          setStatusMessage(results.length ? "" : t("mobileSearchNoPatients"));
        })
        .catch(() => {
          if (!cancelled) {
            setPatients([]);
            setStatusMessage(t("mobileSearchError"));
          }
        });
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, sessionToken, t]);

  async function handleSelect(patient: Patient) {
    setLoadingPatientId(patient.id);
    try {
      const openedPatient = await openPatientRecord(sessionToken, patient.id);
      onPatientSelect(openedPatient);
    } catch {
      setStatusMessage(t("mobileSearchError"));
    } finally {
      setLoadingPatientId(null);
    }
  }

  return (
    <section className="grid gap-4">
      <label className="relative block">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-powder-blue-500"
          strokeWidth={1.5}
        />
        <Input
          className="h-14 pl-12 text-base"
          placeholder={t("mobileSearchPatientInputPlaceholder")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      <div className="grid gap-2">
        {patients.map((patient) => (
          <motion.button
            key={patient.id}
            className="flex min-h-16 items-center rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 px-4 text-left text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-powder-blue-500/70 disabled:opacity-60"
            disabled={loadingPatientId !== null}
            type="button"
            whileTap={{ scale: 0.98 }}
            onClick={() => void handleSelect(patient)}
          >
            <span className="text-lg font-semibold leading-tight">
              {patient.first_name} {patient.last_name}
            </span>
          </motion.button>
        ))}
      </div>

      {statusMessage ? (
        <p className="rounded-xl border border-alabaster-grey-500/20 bg-ink-black-950 p-4 text-sm leading-6 text-alabaster-grey-500">
          {statusMessage}
        </p>
      ) : null}
    </section>
  );
}
