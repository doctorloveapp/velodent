import { CircleDollarSign, FileImage, FileText, FolderOpen, ReceiptText, Stethoscope, Trash2, UserRoundPlus, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/frontend/shared/ui/badge";
import { Button } from "@/frontend/shared/ui/button";
import { Input } from "@/frontend/shared/ui/input";
import { useL10n, type L10nKey } from "@/frontend/shared/i18n/L10nProvider";
import type { User } from "@/frontend/settings/settingsApi";
import { listClinicalServices, type ClinicalService } from "@/frontend/settings/settingsApi";
import { ClinicalPanel } from "@/frontend/clinical/ClinicalPanel";
import {
  addQuoteLine,
  createInvoiceFromQuote,
  createQuoteFromDiagnosis,
  formatCents,
  generateInvoicePdf,
  generateQuotePdf,
  listInvoices,
  listQuotes,
  registerPayment,
  startSumupPayment,
  updateQuoteDiscount,
  updateQuoteStatus,
  euroInputToCents,
  type Invoice,
  type Quote
} from "@/frontend/billing/billingApi";
import {
  createPatient,
  deletePatient,
  importRxFile,
  isTauriRuntime,
  listRxAssets,
  openPatientRecord,
  patientTimeline,
  readTsCns,
  rxAssetDataUrl,
  searchPatients,
  updatePatient,
  type Patient,
  type PatientInput,
  type PatientTimelineEvent,
  type RxAsset
} from "./patientsApi";
import { isValidItalianTaxCode, normalizeTaxCode } from "./taxCode";

interface PatientsViewProps {
  currentUser: User | null;
  selectedPatient: Patient | null;
  onPatientSelected: (patient: Patient | null) => void;
}

type PatientTab = "summary" | "clinical" | "rx" | "documents" | "billing";

const emptyPatientForm = {
  first_name: "",
  last_name: "",
  tax_code: "",
  date_of_birth: "",
  phone: "",
  email: "",
  address: ""
};

const tabs: PatientTab[] = ["summary", "clinical", "rx", "documents", "billing"];

export function PatientsView({ currentUser, onPatientSelected, selectedPatient }: PatientsViewProps) {
  const { t } = useL10n();
  const [backendAvailable] = useState(isTauriRuntime());
  const [patients, setPatients] = useState<Patient[]>([]);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState(emptyPatientForm);
  const [timeline, setTimeline] = useState<PatientTimelineEvent[]>([]);
  const [activeTab, setActiveTab] = useState<PatientTab>("summary");
  const [statusMessage, setStatusMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [lastOpenedPatientId, setLastOpenedPatientId] = useState<number | null>(null);
  const [taxCodeTouched, setTaxCodeTouched] = useState(false);

  const canUseClinicalData = Boolean(backendAvailable && currentUser);
  const normalizedTaxCode = useMemo(() => normalizeTaxCode(form.tax_code), [form.tax_code]);
  const taxCodeValid = useMemo(
    () => normalizedTaxCode.length === 0 || isValidItalianTaxCode(normalizedTaxCode),
    [normalizedTaxCode]
  );

  async function refreshPatients(nextQuery = query) {
    if (!backendAvailable) {
      return;
    }

    if (!currentUser?.session_token) {
      return;
    }

    const results = await searchPatients(currentUser.session_token, nextQuery, 25);
    setPatients(results);
  }

  async function openPatient(patient: Patient) {
    if (!currentUser) {
      setStatusMessage(t("patientsLoginRequired"));
      return;
    }

    if (!currentUser.session_token) {
      setStatusMessage(t("patientsLoginRequired"));
      return;
    }

    const opened = await openPatientRecord(currentUser.session_token, patient.id);
    onPatientSelected(opened);
    setLastOpenedPatientId(opened.id);
    setForm(patientToForm(opened));
    setTaxCodeTouched(false);
    setEditing(true);
    setActiveTab("summary");
    setTimeline(await patientTimeline(currentUser.session_token, opened.id));
    setStatusMessage(t("patientsRecordOpened"));
  }

  useEffect(() => {
    void refreshPatients().catch((error: unknown) => {
      setStatusMessage(error instanceof Error ? error.message : t("patientsGenericError"));
    });
  }, []);

  useEffect(() => {
    if (!selectedPatient || !currentUser || !backendAvailable || selectedPatient.id === lastOpenedPatientId) {
      return;
    }

    void openPatient(selectedPatient).catch((error: unknown) => {
      setStatusMessage(error instanceof Error ? error.message : t("patientsGenericError"));
    });
  }, [selectedPatient?.id, currentUser?.id, backendAvailable, lastOpenedPatientId]);

  if (!backendAvailable) {
    return (
      <PatientSurface
        icon={<FolderOpen aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />}
        title={t("patientsTitle")}
        eyebrow={t("patientsEyebrow")}
      >
        <p className="text-sm text-alabaster-grey-500">{t("patientsTauriUnavailable")}</p>
      </PatientSurface>
    );
  }

  function updateForm(key: keyof typeof emptyPatientForm, value: string) {
    if (key === "tax_code") {
      setTaxCodeTouched(true);
      setForm((current) => ({ ...current, tax_code: value.toUpperCase() }));
      return;
    }
    setForm((current) => ({ ...current, [key]: value }));
  }

  function patientInput(): PatientInput {
    return {
      first_name: form.first_name,
      last_name: form.last_name,
      tax_code: normalizedTaxCode,
      date_of_birth: form.date_of_birth,
      phone: form.phone || undefined,
      email: form.email || undefined,
      address: form.address || undefined
    };
  }

  async function handleSearch(nextQuery: string) {
    setQuery(nextQuery);
    await refreshPatients(nextQuery);
  }

  async function handleSave() {
    if (!currentUser) {
      setStatusMessage(t("patientsLoginRequired"));
      return;
    }

    if (!isValidItalianTaxCode(normalizedTaxCode)) {
      setStatusMessage(t("patientsTaxCodeInvalid"));
      return;
    }

    if (!currentUser.session_token) {
      setStatusMessage(t("patientsLoginRequired"));
      return;
    }

    const saved = editing && selectedPatient
      ? await updatePatient(currentUser.session_token, selectedPatient.id, patientInput())
      : await createPatient(currentUser.session_token, patientInput());

    onPatientSelected(saved);
    setForm(patientToForm(saved));
    setTaxCodeTouched(false);
    setEditing(true);
    setTimeline(await patientTimeline(currentUser.session_token, saved.id));
    setStatusMessage(editing ? t("patientsUpdated") : t("patientsCreated"));
    await refreshPatients();
  }

  async function handleDelete() {
    if (!currentUser || !selectedPatient) {
      setStatusMessage(t("patientsLoginRequired"));
      return;
    }

    if (!currentUser.session_token) {
      setStatusMessage(t("patientsLoginRequired"));
      return;
    }

    await deletePatient(currentUser.session_token, selectedPatient.id);
    onPatientSelected(null);
    setForm(emptyPatientForm);
    setEditing(false);
    setLastOpenedPatientId(null);
    setTimeline([]);
    setStatusMessage(t("patientsDeleted"));
    await refreshPatients();
  }

  async function handleReadTsCns() {
    if (!currentUser?.session_token) {
      setStatusMessage(t("patientsLoginRequired"));
      return;
    }
    const scanned = await readTsCns(currentUser.session_token);
    setForm((current) => ({
      ...current,
      first_name: scanned.first_name,
      last_name: scanned.last_name,
      date_of_birth: scanned.date_of_birth,
      tax_code: scanned.tax_code.toUpperCase()
    }));
    setTaxCodeTouched(false);
    setStatusMessage(t("patientsTsScanned"));
  }

  function handleNewPatient() {
    onPatientSelected(null);
    setForm(emptyPatientForm);
    setTaxCodeTouched(false);
    setEditing(false);
    setLastOpenedPatientId(null);
    setTimeline([]);
    setActiveTab("summary");
    setStatusMessage("");
  }

  return (
    <div className="grid gap-4">
      <PatientSurface
        icon={<UserRoundPlus aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />}
        title={t("patientsTitle")}
        eyebrow={t("patientsEyebrow")}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={currentUser ? "success" : "warning"}>
              {currentUser ? `${t("patientsOperator")}: ${currentUser.username}` : t("patientsLoginRequired")}
            </Badge>
            {statusMessage ? <span className="text-sm text-alabaster-grey-500">{statusMessage}</span> : null}
          </div>
          <Button type="button" variant="secondary" onClick={handleNewPatient}>
            <UserRoundPlus aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
            {t("patientsNew")}
          </Button>
        </div>
      </PatientSurface>

      <div className="grid gap-4 2xl:grid-cols-[380px_minmax(0,1fr)]">
        <PatientSurface
          icon={<FolderOpen aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />}
          title={t("patientsListTitle")}
          eyebrow={t("patientsSearchEyebrow")}
        >
          <Input
            aria-label={t("patientsSearchAria")}
            placeholder={t("patientsSearchPlaceholder")}
            type="search"
            value={query}
            onChange={(event) => void handleSearch(event.target.value)}
          />
          <div className="mt-3 max-h-[520px] overflow-y-auto rounded-md border border-alabaster-grey-500/20">
            {patients.length === 0 ? (
              <p className="px-3 py-4 text-sm text-alabaster-grey-500">{t("patientsEmpty")}</p>
            ) : (
              patients.map((patient) => (
                <button
                  key={patient.id}
                  className="flex w-full items-center justify-between border-b border-alabaster-grey-500/10 px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-powder-blue-950/70"
                  type="button"
                  onClick={() => void openPatient(patient)}
                >
                  <span>
                    <span className="block text-sm font-semibold text-white">
                      {patient.last_name} {patient.first_name}
                    </span>
                    <span className="mt-1 block font-mono text-[11px] text-alabaster-grey-500">
                      {patient.tax_code}
                    </span>
                  </span>
                  <Badge variant="default">{patient.date_of_birth}</Badge>
                </button>
              ))
            )}
          </div>
        </PatientSurface>

        <div className="grid gap-4">
          <PatientSurface
            icon={<FolderOpen aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />}
            title={editing ? t("patientsEditTitle") : t("patientsCreateTitle")}
            eyebrow={t("patientsFormEyebrow")}
          >
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <Input placeholder={t("patientsFirstName")} value={form.first_name} onChange={(event) => updateForm("first_name", event.target.value)} />
              <Input placeholder={t("patientsLastName")} value={form.last_name} onChange={(event) => updateForm("last_name", event.target.value)} />
              <Input placeholder={t("patientsBirthDate")} type="date" value={form.date_of_birth} onChange={(event) => updateForm("date_of_birth", event.target.value)} />
              <Input className="font-mono" placeholder={t("patientsTaxCode")} value={form.tax_code} onChange={(event) => updateForm("tax_code", event.target.value)} />
              <Input placeholder={t("patientsPhone")} value={form.phone} onChange={(event) => updateForm("phone", event.target.value)} />
              <Input placeholder={t("patientsEmail")} type="email" value={form.email} onChange={(event) => updateForm("email", event.target.value)} />
              <Input className="xl:col-span-2" placeholder={t("patientsAddress")} value={form.address} onChange={(event) => updateForm("address", event.target.value)} />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <Badge variant={taxCodeTouched ? (taxCodeValid ? "success" : "danger") : "default"}>
                {taxCodeTouched ? (taxCodeValid ? t("patientsTaxCodeValid") : t("patientsTaxCodeInvalid")) : t("patientsTaxCodeBadge")}
              </Badge>
              <div className="flex gap-2">
                <Button
                  disabled={!canUseClinicalData}
                  type="button"
                  variant="secondary"
                  onClick={() => void handleReadTsCns().catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("patientsTsScanError")))}
                >
                  {t("patientsScanTs")}
                </Button>
                {editing && selectedPatient ? (
                  <Button type="button" variant="secondary" onClick={() => void handleDelete()}>
                    <Trash2 aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
                    {t("patientsDelete")}
                  </Button>
                ) : null}
                <Button disabled={!canUseClinicalData} type="button" onClick={() => void handleSave()}>
                  {editing ? t("patientsSave") : t("patientsCreate")}
                </Button>
              </div>
            </div>
          </PatientSurface>

          <PatientSurface
            icon={<FileText aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />}
            title={selectedPatient ? `${selectedPatient.last_name} ${selectedPatient.first_name}` : t("patientsRecordTitle")}
            eyebrow={t("patientsRecordEyebrow")}
          >
            <div className="mb-4 flex flex-wrap gap-2">
              {tabs.map((tab) => (
                <Button
                  key={tab}
                  type="button"
                  variant={activeTab === tab ? "navActive" : "secondary"}
                  size="sm"
                  onClick={() => setActiveTab(tab)}
                >
                  {t(tabKey(tab))}
                </Button>
              ))}
            </div>
            <PatientTabPanel currentUser={currentUser} patient={selectedPatient} tab={activeTab} />
          </PatientSurface>

          <PatientSurface
            icon={<Stethoscope aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />}
            title={t("patientsTimelineTitle")}
            eyebrow={t("patientsTimelineEyebrow")}
          >
            {timeline.length === 0 ? (
              <p className="text-sm text-alabaster-grey-500">{t("patientsTimelineEmpty")}</p>
            ) : (
              <ol className="grid gap-2">
                {timeline.map((event, index) => (
                  <li key={`${event.action}-${event.created_at}-${String(index)}`} className="flex gap-3 rounded-md border border-alabaster-grey-500/20 bg-ink-black-950 p-3">
                    <span className="mt-1 h-2.5 w-2.5 rounded-full bg-powder-blue-500 shadow-[0_0_12px_rgba(47,127,208,0.8)]" />
                    <span>
                      <span className="block text-sm font-medium text-white">{t(timelineActionKey(event.action))}</span>
                      <span className="mt-1 block font-mono text-[11px] text-alabaster-grey-500">{event.created_at}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </PatientSurface>
        </div>
      </div>
    </div>
  );
}

function PatientTabPanel({ currentUser, patient, tab }: { currentUser: User | null; patient: Patient | null; tab: PatientTab }) {
  const { t } = useL10n();

  if (!patient) {
    return <p className="text-sm text-alabaster-grey-500">{t("patientsRecordEmpty")}</p>;
  }

  if (tab === "summary") {
    return (
      <dl className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <PatientData label={t("patientsTaxCode")} value={patient.tax_code} mono />
        <PatientData label={t("patientsBirthDate")} value={patient.date_of_birth} />
        <PatientData label={t("patientsPhone")} value={patient.phone ?? t("commonEmpty")} />
        <PatientData label={t("patientsEmail")} value={patient.email ?? t("commonEmpty")} />
        <PatientData label={t("patientsAddress")} value={patient.address ?? t("commonEmpty")} wide />
      </dl>
    );
  }

  if (tab === "clinical") {
    return <ClinicalPanel currentUser={currentUser} patient={patient} />;
  }

  if (tab === "rx") {
    return <RxPanel currentUser={currentUser} patient={patient} />;
  }

  if (tab === "documents") {
    return <EmptyTab icon={<FileText aria-hidden="true" className="h-5 w-5" />} text={t("patientsDocumentsEmpty")} />;
  }

  return <BillingPanel currentUser={currentUser} patient={patient} />;
}

function PatientData({ label, mono = false, value, wide = false }: { label: string; mono?: boolean; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "md:col-span-2 xl:col-span-4" : ""}>
      <dt className="text-[10px] font-semibold uppercase tracking-widest text-alabaster-grey-500">{label}</dt>
      <dd className={`mt-1 text-sm font-medium text-white ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

function BillingPanel({ currentUser, patient }: { currentUser: User | null; patient: Patient }) {
  const { t } = useL10n();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [services, setServices] = useState<ClinicalService[]>([]);
  const [selectedQuoteId, setSelectedQuoteId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [discount, setDiscount] = useState("0.00");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  async function refreshBilling() {
    if (!currentUser?.session_token) {
      setStatusMessage(t("patientsLoginRequired"));
      return;
    }
    const [nextQuotes, nextInvoices, nextServices] = await Promise.all([
      listQuotes(currentUser.session_token, patient.id),
      listInvoices(currentUser.session_token, patient.id),
      listClinicalServices(currentUser.session_token)
    ]);
    setQuotes(nextQuotes);
    setInvoices(nextInvoices);
    setServices(nextServices);
    if (!selectedQuoteId && nextQuotes[0]) {
      setSelectedQuoteId(String(nextQuotes[0].id));
      setDiscount((nextQuotes[0].discount_cents / 100).toFixed(2));
    }
  }

  useEffect(() => {
    void refreshBilling().catch((error: unknown) => {
      setStatusMessage(error instanceof Error ? error.message : t("billingGenericError"));
    });
  }, [patient.id, currentUser?.session_token]);

  const selectedQuote = quotes.find((quote) => String(quote.id) === selectedQuoteId) ?? quotes.at(0) ?? null;

  async function handleCreateQuote() {
    if (!currentUser?.session_token) {
      setStatusMessage(t("patientsLoginRequired"));
      return;
    }
    const quote = await createQuoteFromDiagnosis(currentUser.session_token, patient.id, t("billingQuoteDefaultTitle"));
    setSelectedQuoteId(String(quote.id));
    setStatusMessage(t("billingQuoteCreated"));
    await refreshBilling();
  }

  async function handleAddLine() {
    if (!currentUser?.session_token || !selectedQuote || !serviceId) {
      return;
    }
    const quote = await addQuoteLine(currentUser.session_token, selectedQuote.id, Number(serviceId), Number(quantity) || 1);
    setSelectedQuoteId(String(quote.id));
    setStatusMessage(t("billingQuoteLineAdded"));
    await refreshBilling();
  }

  async function handleDiscount() {
    if (!currentUser?.session_token || !selectedQuote) {
      return;
    }
    const quote = await updateQuoteDiscount(currentUser.session_token, selectedQuote.id, euroInputToCents(discount));
    setSelectedQuoteId(String(quote.id));
    setStatusMessage(t("billingDiscountSaved"));
    await refreshBilling();
  }

  async function handleQuoteStatus(status: "accepted" | "rejected") {
    if (!currentUser?.session_token || !selectedQuote) {
      return;
    }
    const quote = await updateQuoteStatus(currentUser.session_token, selectedQuote.id, status);
    setSelectedQuoteId(String(quote.id));
    setStatusMessage(status === "accepted" ? t("billingQuoteAccepted") : t("billingQuoteRejected"));
    await refreshBilling();
  }

  async function handleInvoice() {
    if (!currentUser?.session_token || !selectedQuote) {
      return;
    }
    await createInvoiceFromQuote(currentUser.session_token, selectedQuote.id);
    setStatusMessage(t("billingInvoiceIssued"));
    await refreshBilling();
  }

  async function handleQuotePdf() {
    if (!currentUser?.session_token || !selectedQuote) {
      return;
    }
    const document = await generateQuotePdf(currentUser.session_token, selectedQuote.id);
    setStatusMessage(`${t("billingPdfGenerated")}: ${document.relative_path}`);
  }

  async function handleInvoicePdf(invoice: Invoice) {
    if (!currentUser?.session_token) {
      return;
    }
    const document = await generateInvoicePdf(currentUser.session_token, invoice.id);
    setStatusMessage(`${t("billingPdfGenerated")}: ${document.relative_path}`);
  }

  async function handlePayment(invoice: Invoice, method: "cash" | "bank_transfer") {
    if (!currentUser?.session_token) {
      return;
    }
    const amount = paymentAmount.trim() ? euroInputToCents(paymentAmount) : invoice.total_cents - invoice.paid_cents;
    await registerPayment(currentUser.session_token, invoice.id, method, amount);
    setPaymentAmount("");
    setStatusMessage(t("billingPaymentRegistered"));
    await refreshBilling();
  }

  async function handleSumup(invoice: Invoice) {
    if (!currentUser?.session_token) {
      return;
    }
    const result = await startSumupPayment(currentUser.session_token, invoice.id, "sumup_link");
    setStatusMessage(result.checkout.checkout_url ?? t("billingSumupStarted"));
    await refreshBilling();
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Badge variant="default">{t("billingWorkflow")}</Badge>
        {statusMessage ? <span className="text-xs text-alabaster-grey-500">{statusMessage}</span> : null}
        <Button type="button" size="sm" onClick={() => void handleCreateQuote().catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("billingGenericError")))}>
          <CircleDollarSign aria-hidden="true" className="h-4 w-4" />
          {t("billingCreateQuote")}
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="grid gap-3 rounded-md border border-alabaster-grey-500/20 bg-ink-black-950 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-10 min-w-[220px] rounded-md border border-alabaster-grey-500/20 bg-glaucous-950 px-3 text-sm text-white outline-none focus:border-powder-blue-500"
              value={selectedQuote?.id ?? ""}
              onChange={(event) => {
                setSelectedQuoteId(event.target.value);
                const quote = quotes.find((row) => String(row.id) === event.target.value);
                setDiscount(((quote?.discount_cents ?? 0) / 100).toFixed(2));
              }}
            >
              {quotes.map((quote) => (
                <option key={quote.id} value={quote.id}>
                  #{quote.id} {quote.title}
                </option>
              ))}
            </select>
            {selectedQuote ? <Badge variant={quoteBadgeVariant(selectedQuote.status)}>{t(quoteStatusKey(selectedQuote.status))}</Badge> : null}
          </div>

          {selectedQuote ? (
            <>
              <DenseBillingRows
                rows={selectedQuote.lines.map((line) => [
                  line.description,
                  String(line.quantity),
                  formatCents(line.unit_price_cents),
                  formatCents(line.total_cents)
                ])}
              />
              <div className="grid gap-2 md:grid-cols-[1fr_100px_auto]">
                <select
                  className="h-10 rounded-md border border-alabaster-grey-500/20 bg-glaucous-950 px-3 text-sm text-white outline-none focus:border-powder-blue-500"
                  disabled={selectedQuote.status !== "draft"}
                  value={serviceId}
                  onChange={(event) => setServiceId(event.target.value)}
                >
                  <option value="">{t("billingSelectService")}</option>
                  {services.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.code} - {service.name}
                    </option>
                  ))}
                </select>
                <Input disabled={selectedQuote.status !== "draft"} min={1} type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
                <Button disabled={selectedQuote.status !== "draft"} type="button" variant="secondary" onClick={() => void handleAddLine().catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("billingGenericError")))}>
                  {t("billingAddLine")}
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-alabaster-grey-500/15 pt-3">
                <div className="grid gap-1 text-sm text-alabaster-grey-500">
                  <span>{t("billingGross")}: {formatCents(selectedQuote.gross_total_cents)}</span>
                  <span>{t("billingDiscount")}: {formatCents(selectedQuote.discount_cents)}</span>
                  <span className="font-semibold text-white">{t("billingNet")}: {formatCents(selectedQuote.net_total_cents)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input className="w-28" disabled={selectedQuote.status !== "draft"} type="number" min={0} step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)} />
                  <Button disabled={selectedQuote.status !== "draft"} type="button" variant="secondary" size="sm" onClick={() => void handleDiscount().catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("billingGenericError")))}>
                    {t("billingSaveDiscount")}
                  </Button>
                  <Button disabled={selectedQuote.status !== "draft"} type="button" variant="secondary" size="sm" onClick={() => void handleQuoteStatus("rejected").catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("billingGenericError")))}>
                    {t("billingRejectQuote")}
                  </Button>
                  <Button disabled={selectedQuote.status !== "draft"} type="button" size="sm" onClick={() => void handleQuoteStatus("accepted").catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("billingGenericError")))}>
                    {t("billingAcceptQuote")}
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => void handleQuotePdf().catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("billingGenericError")))}>
                    {t("billingPdf")}
                  </Button>
                  <Button disabled={selectedQuote.status !== "accepted"} type="button" size="sm" onClick={() => void handleInvoice().catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("billingGenericError")))}>
                    {t("billingIssueInvoice")}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <EmptyTab icon={<ReceiptText aria-hidden="true" className="h-5 w-5" />} text={t("patientsBillingEmpty")} />
          )}
        </div>

        <div className="grid gap-3 rounded-md border border-alabaster-grey-500/20 bg-ink-black-950 p-3">
          <h3 className="text-sm font-semibold text-white">{t("billingInvoicesTitle")}</h3>
          {invoices.length === 0 ? (
            <p className="text-sm text-alabaster-grey-500">{t("billingInvoicesEmpty")}</p>
          ) : (
            invoices.map((invoice) => (
              <div key={invoice.id} className="grid gap-3 rounded-md border border-alabaster-grey-500/15 bg-glaucous-950 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-sm text-white">{invoice.invoice_number}/{invoice.invoice_year}</span>
                  <Badge variant={invoice.payment_status === "paid" ? "success" : invoice.payment_status === "partial" ? "warning" : "default"}>
                    {t(invoiceStatusKey(invoice.payment_status))}
                  </Badge>
                </div>
                <div className="grid gap-1 text-sm text-alabaster-grey-500">
                  <span>{t("billingIssuedAt")}: {invoice.issued_at}</span>
                  <span>{t("billingNet")}: {formatCents(invoice.total_cents)}</span>
                  <span>{t("billingPaid")}: {formatCents(invoice.paid_cents)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input className="w-28" type="number" min={0} step="0.01" placeholder={t("billingPaymentAmount")} value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} />
                  <Button type="button" variant="secondary" size="sm" onClick={() => void handlePayment(invoice, "cash").catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("billingGenericError")))}>
                    {t("billingCash")}
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => void handlePayment(invoice, "bank_transfer").catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("billingGenericError")))}>
                    {t("billingBankTransfer")}
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => void handleSumup(invoice).catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("billingGenericError")))}>
                    {t("billingSumup")}
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => void handleInvoicePdf(invoice).catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("billingGenericError")))}>
                    {t("billingPdf")}
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function DenseBillingRows({ rows }: { rows: string[][] }) {
  const { t } = useL10n();

  return (
    <div className="overflow-hidden rounded-md border border-alabaster-grey-500/20">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-glaucous-950 text-[10px] uppercase tracking-widest text-alabaster-grey-500">
          <tr>
            {[t("billingDescription"), t("billingQuantity"), t("billingUnit"), t("billingTotal")].map((header) => (
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
                <td key={`${String(rowIndex)}-${String(cellIndex)}`} className="px-3 py-2 text-alabaster-grey-500">
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

function EmptyTab({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-alabaster-grey-500/20 bg-ink-black-950 p-4 text-sm text-alabaster-grey-500">
      <span className="text-powder-blue-500">{icon}</span>
      {text}
    </div>
  );
}

function PatientSurface({ children, eyebrow, icon, title }: { children: ReactNode; eyebrow: string; icon: ReactNode; title: string }) {
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

function patientToForm(patient: Patient) {
  return {
    first_name: patient.first_name,
    last_name: patient.last_name,
    tax_code: patient.tax_code,
    date_of_birth: patient.date_of_birth,
    phone: patient.phone ?? "",
    email: patient.email ?? "",
    address: patient.address ?? ""
  };
}

function tabKey(tab: PatientTab): L10nKey {
  if (tab === "summary") {
    return "patientsTabSummary";
  }

  if (tab === "clinical") {
    return "patientsTabClinical";
  }

  if (tab === "documents") {
    return "patientsTabDocuments";
  }

  if (tab === "rx") {
    return "patientsTabRx";
  }

  return "patientsTabBilling";
}

function timelineActionKey(action: string): L10nKey {
  if (action === "PATIENT_RECORD_VIEW") {
    return "patientsTimelineView";
  }

  if (action === "patient.created") {
    return "patientsTimelineCreated";
  }

  if (action === "patient.updated") {
    return "patientsTimelineUpdated";
  }

  if (action === "patient.deleted") {
    return "patientsTimelineDeleted";
  }

  if (action === "FILE_IMPORT") {
    return "patientsTimelineFileImport";
  }

  if (action === "FILE_ACCESS") {
    return "patientsTimelineFileAccess";
  }

  return "patientsTimelineOther";
}

function RxPanel({ currentUser, patient }: { currentUser: User | null; patient: Patient }) {
  const { t } = useL10n();
  const [assets, setAssets] = useState<RxAsset[]>([]);
  const [previews, setPreviews] = useState<Record<number, string>>({});
  const [sourcePath, setSourcePath] = useState("");
  const [rxType, setRxType] = useState("endoral");
  const [toothNumber, setToothNumber] = useState("");
  const [viewerAsset, setViewerAsset] = useState<RxAsset | null>(null);
  const [viewerDataUrl, setViewerDataUrl] = useState("");
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [statusMessage, setStatusMessage] = useState("");

  async function refreshAssets() {
    if (!currentUser?.session_token) {
      setStatusMessage(t("patientsLoginRequired"));
      return;
    }

    const sessionToken = currentUser.session_token;
    const nextAssets = await listRxAssets(sessionToken, patient.id);
    setAssets(nextAssets);
    const imageAssets = nextAssets.filter((asset) => asset.mime_type?.startsWith("image/"));
    const entries = await Promise.all(
      imageAssets.map(async (asset) => {
        const preview = await rxAssetDataUrl(sessionToken, asset.file_asset_id);
        return [asset.file_asset_id, preview.data_url] as const;
      })
    );
    setPreviews(Object.fromEntries(entries));
  }

  async function handleImport() {
    if (!currentUser?.session_token) {
      setStatusMessage(t("patientsLoginRequired"));
      return;
    }

    const imported = await importRxFile({
      session_token: currentUser.session_token,
      patient_id: patient.id,
      source_path: sourcePath,
      rx_type: rxType,
      tooth_number: toothNumber.trim() ? Number(toothNumber) : undefined
    });
    setStatusMessage(`${t("rxImportCompleted")}: ${imported.relative_path}`);
    setSourcePath("");
    await refreshAssets();
  }

  async function openViewer(asset: RxAsset) {
    if (!currentUser?.session_token) {
      setStatusMessage(t("patientsLoginRequired"));
      return;
    }

    if (!asset.mime_type?.startsWith("image/")) {
      setStatusMessage(t("rxDicomPreviewUnavailable"));
      return;
    }

    const preview = previews[asset.file_asset_id] ?? (await rxAssetDataUrl(currentUser.session_token, asset.file_asset_id)).data_url;
    setViewerAsset(asset);
    setViewerDataUrl(preview);
    setBrightness(100);
    setContrast(100);
  }

  useEffect(() => {
    void refreshAssets().catch((error: unknown) => {
      setStatusMessage(error instanceof Error ? error.message : t("rxGenericError"));
    });
  }, [patient.id, currentUser?.session_token]);

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 rounded-md border border-alabaster-grey-500/20 bg-ink-black-950 p-3 xl:grid-cols-[minmax(0,1fr)_160px_120px_auto]">
        <Input
          placeholder={t("rxSourcePathPlaceholder")}
          value={sourcePath}
          onChange={(event) => setSourcePath(event.target.value)}
        />
        <select
          className="h-10 rounded-md border border-alabaster-grey-500/20 bg-ink-black-950 px-3 text-sm text-white outline-none focus:border-powder-blue-500"
          value={rxType}
          onChange={(event) => setRxType(event.target.value)}
        >
          <option value="endoral">{t("rxTypeEndoral")}</option>
          <option value="panoramic">{t("rxTypePanoramic")}</option>
          <option value="cbct">{t("rxTypeCbct")}</option>
          <option value="photo">{t("rxTypePhoto")}</option>
        </select>
        <Input
          className="font-mono"
          placeholder={t("clinicalToothNumber")}
          value={toothNumber}
          onChange={(event) => setToothNumber(event.target.value)}
        />
        <Button type="button" onClick={() => void handleImport().catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("rxGenericError")))}>
          {t("rxImportAction")}
        </Button>
      </div>
      {statusMessage ? <p className="text-xs leading-5 text-alabaster-grey-500">{statusMessage}</p> : null}
      {assets.length === 0 ? (
        <EmptyTab icon={<FileImage aria-hidden="true" className="h-5 w-5" />} text={t("rxEmpty")} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {assets.map((asset) => (
            <button
              key={asset.id}
              className="group overflow-hidden rounded-md border border-alabaster-grey-500/20 bg-ink-black-950 text-left transition-colors hover:border-powder-blue-500/60"
              type="button"
              onClick={() => void openViewer(asset).catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : t("rxGenericError")))}
            >
              <div className="flex aspect-[4/3] items-center justify-center bg-glaucous-950">
                {previews[asset.file_asset_id] ? (
                  <img alt={t("rxThumbnailAlt")} className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100" src={previews[asset.file_asset_id]} />
                ) : (
                  <FileImage aria-hidden="true" className="h-10 w-10 text-powder-blue-500" strokeWidth={1.5} />
                )}
              </div>
              <div className="grid gap-1 p-3">
                <span className="text-sm font-semibold text-white">{t(rxTypeKey(asset.rx_type))}</span>
                <span className="truncate font-mono text-[11px] text-alabaster-grey-500">{asset.relative_path}</span>
                <span className="text-[11px] text-alabaster-grey-500">{asset.tooth_number ? `${t("clinicalToothNumber")}: ${String(asset.tooth_number)}` : t("clinicalArch")}</span>
              </div>
            </button>
          ))}
        </div>
      )}
      {viewerAsset ? (
        <div className="fixed inset-0 z-50 grid bg-ink-black-950/85 p-4 backdrop-blur-xl">
          <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] rounded-lg border border-alabaster-grey-500/20 bg-white/10 shadow-[0_24px_80px_rgba(0,0,0,0.48)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-alabaster-grey-500/20 p-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-pale-sky-500">{t("rxViewerEyebrow")}</p>
                <h3 className="text-sm font-semibold text-white">{t(rxTypeKey(viewerAsset.rx_type))}</h3>
              </div>
              <Button type="button" variant="secondary" size="sm" onClick={() => setViewerAsset(null)}>
                <X aria-hidden="true" className="h-4 w-4" />
                {t("rxViewerClose")}
              </Button>
            </div>
            <div className="flex min-h-0 items-center justify-center overflow-hidden p-4">
              <img
                alt={t("rxViewerAlt")}
                className="max-h-full max-w-full rounded-md object-contain"
                src={viewerDataUrl}
                style={{ filter: `brightness(${String(brightness)}%) contrast(${String(contrast)}%)` }}
              />
            </div>
            <div className="grid gap-3 border-t border-alabaster-grey-500/20 p-3 md:grid-cols-2">
              <label className="grid gap-2 text-xs font-medium text-alabaster-grey-500">
                {t("rxBrightness")}
                <input min="50" max="160" type="range" value={brightness} onChange={(event) => setBrightness(Number(event.target.value))} />
              </label>
              <label className="grid gap-2 text-xs font-medium text-alabaster-grey-500">
                {t("rxContrast")}
                <input min="50" max="180" type="range" value={contrast} onChange={(event) => setContrast(Number(event.target.value))} />
              </label>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function rxTypeKey(rxType: string): L10nKey {
  if (rxType === "panoramic") {
    return "rxTypePanoramic";
  }

  if (rxType === "cbct") {
    return "rxTypeCbct";
  }

  if (rxType === "photo") {
    return "rxTypePhoto";
  }

  return "rxTypeEndoral";
}

function quoteStatusKey(status: string): L10nKey {
  if (status === "accepted") {
    return "billingQuoteAcceptedStatus";
  }

  if (status === "rejected") {
    return "billingQuoteRejectedStatus";
  }

  return "billingQuoteDraftStatus";
}

function quoteBadgeVariant(status: string) {
  if (status === "accepted") {
    return "success" as const;
  }

  if (status === "rejected") {
    return "danger" as const;
  }

  return "warning" as const;
}

function invoiceStatusKey(status: string): L10nKey {
  if (status === "paid") {
    return "billingInvoicePaid";
  }

  if (status === "partial") {
    return "billingInvoicePartial";
  }

  return "billingInvoicePending";
}
