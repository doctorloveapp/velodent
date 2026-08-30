import { invoke } from "@tauri-apps/api/core";

import type { ClinicalRecord } from "@/frontend/clinical/clinicalApi";

export type QuoteStatus = "draft" | "accepted" | "rejected" | "closed";
export type PaymentStatus = "pending" | "paid" | "partial";

export interface QuoteLine {
  id: number;
  quote_id: number;
  clinical_record_id: number | null;
  service_id: number | null;
  description: string;
  quantity: number;
  unit_price_cents: number;
  total_cents: number;
  created_at: string;
  updated_at: string;
}

export interface Quote {
  id: number;
  patient_id: number;
  title: string;
  status: QuoteStatus;
  version: number;
  parent_quote_id: number | null;
  gross_total_cents: number;
  discount_cents: number;
  net_total_cents: number;
  previous_paid_cents: number;
  balance_due_cents: number;
  accepted_at: string | null;
  last_reminder_snoozed_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  lines: QuoteLine[];
}

export interface QuoteCareAlert {
  quote_id: number;
  patient_id: number;
  show_new_records_alert: boolean;
  snoozed_until: string | null;
  new_records: ClinicalRecord[];
  all_lines_performed: boolean;
  balance_is_zero: boolean;
}

export interface InvoiceLine {
  id: number;
  invoice_id: number;
  quote_line_id: number | null;
  description: string;
  quantity: number;
  unit_price_cents: number;
  total_cents: number;
  created_at: string;
  updated_at: string;
}

export interface Invoice {
  id: number;
  patient_id: number;
  quote_id: number | null;
  invoice_kind: "final" | "deposit";
  invoice_number: number;
  invoice_year: number;
  issued_at: string;
  total_cents: number;
  paid_cents: number;
  payment_status: PaymentStatus;
  stamp_duty_paid: boolean;
  health_system_status: string;
  created_at: string;
  updated_at: string;
  lines: InvoiceLine[];
}

export interface GeneratedDocument {
  file_asset_id: number;
  relative_path: string;
  mime_type: string;
  sha256_hex: string;
  size_bytes: number;
}

export interface Payment {
  id: number;
  invoice_id: number;
  method: string;
  amount_cents: number;
  sumup_transaction_id: string | null;
  status: string;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SumupCheckout {
  checkout_id: string;
  checkout_reference: string;
  amount_cents: number;
  currency: string;
  checkout_url: string | null;
}

export async function listQuotes(session_token: string, patient_id: number) {
  return invoke<Quote[]>("list_quotes", { request: { session_token, patient_id } });
}

export async function createQuoteFromDiagnosis(session_token: string, patient_id: number, title?: string) {
  return invoke<Quote>("create_quote_from_diagnosis", { request: { session_token, patient_id, title } });
}

export async function addQuoteLine(session_token: string, quote_id: number, service_id: number, quantity: number) {
  return invoke<Quote>("add_quote_line", { request: { session_token, quote_id, service_id, quantity } });
}

export async function updateQuoteDiscount(session_token: string, quote_id: number, discount_cents: number) {
  return invoke<Quote>("update_quote_discount", { request: { session_token, quote_id, discount_cents } });
}

export async function updateQuoteStatus(session_token: string, quote_id: number, status: QuoteStatus) {
  return invoke<Quote>("update_quote_status", { request: { session_token, quote_id, status } });
}

export async function quoteCareAlert(session_token: string, quote_id: number) {
  return invoke<QuoteCareAlert>("quote_care_alert", { request: { session_token, quote_id } });
}

export async function updateQuoteWithNewRecords(session_token: string, quote_id: number) {
  return invoke<Quote>("update_quote_with_new_records", { request: { session_token, quote_id } });
}

export async function ignoreQuoteNewRecords(session_token: string, quote_id: number) {
  return invoke<QuoteCareAlert>("ignore_quote_new_records", { request: { session_token, quote_id } });
}

export async function snoozeQuoteNewRecordsReminder(session_token: string, quote_id: number) {
  return invoke<QuoteCareAlert>("snooze_quote_new_records_reminder", { request: { session_token, quote_id } });
}

export async function reviseQuote(session_token: string, quote_id: number) {
  return invoke<Quote>("revise_quote", { request: { session_token, quote_id } });
}

export async function closeQuote(session_token: string, quote_id: number) {
  return invoke<Quote>("close_quote", { request: { session_token, quote_id } });
}

export async function generateQuotePdf(session_token: string, quote_id: number) {
  return invoke<GeneratedDocument>("generate_quote_pdf", { request: { session_token, quote_id } });
}

export async function listInvoices(session_token: string, patient_id: number) {
  return invoke<Invoice[]>("list_invoices", { request: { session_token, patient_id } });
}

export async function createInvoiceFromQuote(session_token: string, quote_id: number) {
  return invoke<Invoice>("create_invoice_from_quote", { request: { session_token, quote_id } });
}

export async function createDepositInvoice(
  session_token: string,
  quote_id: number,
  amount_cents: number,
  method: "cash" | "bank_transfer" | "sumup_pos"
) {
  return invoke<Invoice>("create_deposit_invoice", { request: { session_token, quote_id, amount_cents, method } });
}

export async function generateInvoicePdf(session_token: string, invoice_id: number) {
  return invoke<GeneratedDocument>("generate_invoice_pdf", { request: { session_token, invoice_id } });
}

export async function registerPayment(
  session_token: string,
  invoice_id: number,
  method: "cash" | "bank_transfer" | "sumup_pos",
  amount_cents: number
) {
  return invoke<Payment>("register_payment", {
    request: { session_token, invoice_id, method, amount_cents, status: "success" }
  });
}

export async function startSumupPayment(session_token: string, invoice_id: number, method: "sumup_link" | "sumup_pos") {
  return invoke<{ payment: Payment; checkout: SumupCheckout }>("start_sumup_payment", {
    request: { session_token, invoice_id, method }
  });
}

export function formatCents(cents: number) {
  return new Intl.NumberFormat(undefined, { currency: "EUR", style: "currency" }).format(cents / 100);
}

export function euroInputToCents(value: string) {
  const parsed = Number.parseFloat(value.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.round(parsed * 100);
}
