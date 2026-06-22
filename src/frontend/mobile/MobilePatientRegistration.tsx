import { Keyboard, Save, type LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { useState } from "react";
import { useL10n } from "@/frontend/shared/i18n/L10nProvider";
import { Button } from "@/frontend/shared/ui/button";
import { Input } from "@/frontend/shared/ui/input";

interface MobilePatientDraft {
  first_name: string;
  last_name: string;
  tax_code: string;
  date_of_birth: string;
  phone: string;
  email: string;
  address: string;
}

const emptyDraft: MobilePatientDraft = {
  first_name: "",
  last_name: "",
  tax_code: "",
  date_of_birth: "",
  phone: "",
  email: "",
  address: ""
};

export function MobilePatientRegistration() {
  const { t } = useL10n();
  const [draft, setDraft] = useState<MobilePatientDraft | null>(null);

  function startManualEntry() {
    setDraft(emptyDraft);
  }

  return (
    <section className="grid min-h-[calc(100dvh-7.5rem)] content-between gap-6">
      {draft ? (
        <MobilePatientDraftForm
          draft={draft}
          sourceLabel={t("mobileFormManual")}
          onDraftChange={setDraft}
        />
      ) : (
        <div className="grid gap-4">
          <div className="rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">
              {t("mobileNewPatient")}
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-white">{t("mobileRegistrationChoiceTitle")}</h1>
            <p className="mt-3 text-sm leading-6 text-alabaster-grey-500">
              {t("mobileRegistrationChoiceBody")}
            </p>
          </div>

          <div className="grid gap-3">
            <MobileChoiceButton
              icon={Keyboard}
              label={t("mobileManualEntry")}
              onClick={startManualEntry}
            />
          </div>
        </div>
      )}

      {draft ? (
        <div
          className="sticky bottom-0 -mx-4 border-t border-alabaster-grey-500/20 bg-ink-black-950/95 px-4 py-3 backdrop-blur"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          <Button type="button" className="h-14 w-full justify-center text-base" disabled>
            <Save aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
            {t("mobileFormPendingSave")}
          </Button>
        </div>
      ) : null}

    </section>
  );
}

function MobileChoiceButton({
  icon: Icon,
  label,
  onClick
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <motion.button
      className="flex min-h-24 w-full items-center gap-4 rounded-xl border border-alabaster-grey-500/20 bg-glaucous-950 p-4 text-left text-white shadow-[0_16px_40px_rgba(0,0,0,0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-powder-blue-500/70"
      type="button"
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-powder-blue-500/30 bg-powder-blue-950 text-powder-blue-500">
        <Icon aria-hidden="true" className="h-6 w-6" strokeWidth={1.5} />
      </span>
      <span className="text-lg font-semibold leading-tight">{label}</span>
    </motion.button>
  );
}

function MobilePatientDraftForm({
  draft,
  sourceLabel,
  onDraftChange
}: {
  draft: MobilePatientDraft;
  sourceLabel: string;
  onDraftChange: (draft: MobilePatientDraft) => void;
}) {
  const { t } = useL10n();

  function update<K extends keyof MobilePatientDraft>(key: K, value: MobilePatientDraft[K]) {
    onDraftChange({ ...draft, [key]: value });
  }

  return (
    <div className="grid gap-4">
      <div className="rounded-xl border border-powder-blue-500/20 bg-glaucous-950 p-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">
          {sourceLabel}
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-white">{t("mobilePatientFormTitle")}</h1>
        <p className="mt-3 text-sm leading-6 text-alabaster-grey-500">{t("mobilePatientFormBody")}</p>
      </div>

      <div className="grid gap-3">
        <LabeledInput
          label={t("patientsFirstName")}
          value={draft.first_name}
          onChange={(value) => update("first_name", value)}
        />
        <LabeledInput
          label={t("patientsLastName")}
          value={draft.last_name}
          onChange={(value) => update("last_name", value)}
        />
        <LabeledInput
          label={t("patientsBirthDate")}
          type="date"
          value={draft.date_of_birth}
          onChange={(value) => update("date_of_birth", value)}
        />
        <LabeledInput
          label={t("patientsTaxCode")}
          value={draft.tax_code}
          onChange={(value) => update("tax_code", value.toUpperCase())}
        />
        <LabeledInput
          inputMode="tel"
          label={t("patientsPhone")}
          value={draft.phone}
          onChange={(value) => update("phone", value)}
        />
        <LabeledInput
          inputMode="email"
          label={t("patientsEmail")}
          value={draft.email}
          onChange={(value) => update("email", value)}
        />
        <LabeledInput
          label={t("patientsAddress")}
          value={draft.address}
          onChange={(value) => update("address", value)}
        />
      </div>
    </div>
  );
}

function LabeledInput({
  inputMode,
  label,
  onChange,
  type = "text",
  value
}: {
  inputMode?: "email" | "tel";
  label: string;
  onChange: (value: string) => void;
  type?: "date" | "text";
  value: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-alabaster-grey-500">
        {label}
      </span>
      <Input
        className="h-12 text-base"
        inputMode={inputMode}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
