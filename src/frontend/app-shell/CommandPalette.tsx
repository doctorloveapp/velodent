import { AnimatePresence, motion } from "framer-motion";
import { Search, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { isTauriRuntime, searchPatients, type Patient } from "@/frontend/patients/patientsApi";
import { useL10n } from "@/frontend/shared/i18n/L10nProvider";
import { Input } from "@/frontend/shared/ui/input";

interface CommandPaletteProps {
  open: boolean;
  sessionToken: string;
  onClose: () => void;
  onPatientSelected: (patient: Patient) => void;
}

export function CommandPalette({ onClose, onPatientSelected, open, sessionToken }: CommandPaletteProps) {
  const { t } = useL10n();
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }

    setQuery("");
    setMessage("");

    if (!isTauriRuntime() || !sessionToken) {
      setPatients([]);
      setMessage(t("commandPaletteTauriUnavailable"));
      return;
    }

    void searchPatients(sessionToken, "", 8)
      .then(setPatients)
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : t("commandPaletteSearchError"));
      });
  }, [open, sessionToken, t]);

  useEffect(() => {
    if (!open || !isTauriRuntime() || !sessionToken) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void searchPatients(sessionToken, query, 8)
        .then(setPatients)
        .catch((error: unknown) => {
          setMessage(error instanceof Error ? error.message : t("commandPaletteSearchError"));
        });
    }, 120);

    return () => window.clearTimeout(timeout);
  }, [open, query, sessionToken, t]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink-black-950/70 px-4 pt-[12vh]"
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={onClose}
        >
          <motion.div
            animate={{ opacity: 1, scale: 1 }}
            className="glass w-full max-w-2xl overflow-hidden rounded-xl border border-alabaster-grey-500/20 shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
            exit={{ opacity: 0, scale: 0.95 }}
            initial={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="border-b border-alabaster-grey-500/20 p-3">
              <div className="relative">
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-alabaster-grey-500" strokeWidth={1.5} />
                <Input
                  autoFocus
                  className="h-11 border-transparent bg-transparent pl-10"
                  placeholder={t("commandPalettePlaceholder")}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            </div>

            <div className="max-h-[360px] overflow-y-auto p-2">
              {message ? <p className="px-3 py-6 text-sm text-alabaster-grey-500">{message}</p> : null}
              {!message && patients.length === 0 ? (
                <p className="px-3 py-6 text-sm text-alabaster-grey-500">{t("commandPaletteNoResults")}</p>
              ) : null}
              {patients.map((patient) => (
                <button
                  key={patient.id}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-3 text-left transition-colors hover:bg-powder-blue-950 focus:bg-powder-blue-950 focus:outline-none"
                  type="button"
                  onClick={() => {
                    onPatientSelected(patient);
                    onClose();
                  }}
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-md border border-powder-blue-500/30 bg-powder-blue-950 text-powder-blue-500">
                    <UserRound aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-white">
                      {patient.last_name} {patient.first_name}
                    </span>
                    <span className="block truncate font-mono text-xs text-alabaster-grey-500">
                      {patient.tax_code}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
