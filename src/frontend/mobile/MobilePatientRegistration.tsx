import { Save } from "lucide-react";
import { useState } from "react";
import { createPatient } from "@/frontend/patients/patientsApi";
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

export function MobilePatientRegistration({ sessionToken }: { sessionToken: string }) {
  const { t } = useL10n();
  const [draft, setDraft] = useState<MobilePatientDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const canSave = Boolean(
    draft.first_name.trim()
    && draft.last_name.trim()
    && draft.tax_code.trim()
    && draft.date_of_birth.trim()
  );

  async function handleSave() {
    if (!canSave || saving) {
      return;
    }
    setSaving(true);
    try {
      await createPatient(sessionToken, {
        first_name: draft.first_name.trim(),
        last_name: draft.last_name.trim(),
        tax_code: draft.tax_code.trim().toUpperCase(),
        date_of_birth: draft.date_of_birth,
        phone: draft.phone.trim() || undefined,
        email: draft.email.trim() || undefined,
        address: draft.address.trim() || undefined
      });
      setDraft(emptyDraft);
      setStatusMessage(t("mobilePatientSaved"));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : t("patientsGenericError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="grid min-h-[calc(100dvh-7.5rem)] content-between gap-6">
      <MobilePatientDraftForm
        draft={draft}
        sourceLabel={t("mobileFormManual")}
        onDraftChange={setDraft}
      />
      {statusMessage ? <p className="text-sm text-powder-blue-500">{statusMessage}</p> : null}

      <div
        className="sticky bottom-0 -mx-4 border-t border-alabaster-grey-500/20 bg-ink-black-950/95 px-4 py-3 backdrop-blur"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <Button
          type="button"
          className="h-14 w-full justify-center text-base"
          disabled={!canSave || saving}
          onClick={() => void handleSave()}
        >
          <Save aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
          {saving ? t("saving") : t("mobilePatientSave")}
        </Button>
      </div>
    </section>
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
