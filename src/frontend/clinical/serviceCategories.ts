import type { L10nKey } from "@/frontend/shared/i18n/L10nProvider";

export type ClinicalServiceGroupKey =
  | "diagnosis"
  | "hygiene"
  | "conservative"
  | "endodontics"
  | "prosthesis"
  | "surgery"
  | "orthodontics"
  | "various";

export type ClinicalQuickActionKey =
  | "diagnosis"
  | "hygiene"
  | "caries"
  | "endodontics"
  | "periodontics"
  | "crown"
  | "extraction"
  | "mobileProsthesis";

export const clinicalServiceGroupOrder: ClinicalServiceGroupKey[] = [
  "diagnosis",
  "hygiene",
  "conservative",
  "endodontics",
  "prosthesis",
  "surgery",
  "orthodontics",
  "various"
];

export function clinicalServiceGroupKey(category: string | null): ClinicalServiceGroupKey {
  const value = category?.trim().toLowerCase() ?? "";
  if (value.includes("diagnosi")) {
    return "diagnosis";
  }
  if (value.includes("igiene")) {
    return "hygiene";
  }
  if (value.includes("parodont")) {
    return "various";
  }
  if (value.includes("conservativa")) {
    return "conservative";
  }
  if (value.includes("endodonzia")) {
    return "endodontics";
  }
  if (value.includes("protesi") || value.includes("corona")) {
    return "prosthesis";
  }
  if (value.includes("chirurgia") || value.includes("estrazione") || value.includes("implant")) {
    return "surgery";
  }
  if (value.includes("ortodonz")) {
    return "orthodontics";
  }
  return "various";
}

export function clinicalServiceGroupLabelKey(group: ClinicalServiceGroupKey): L10nKey {
  return `tariffarioGroup${group.charAt(0).toUpperCase()}${group.slice(1)}` as L10nKey;
}

export function clinicalServiceMatchesQuickAction(
  category: string | null,
  action: ClinicalQuickActionKey
) {
  const value = category?.trim().toLowerCase() ?? "";
  const group = clinicalServiceGroupKey(category);
  if (action === "diagnosis") {
    return group === "diagnosis";
  }
  if (action === "hygiene") {
    return group === "hygiene";
  }
  if (action === "caries") {
    return group === "conservative";
  }
  if (action === "endodontics") {
    return group === "endodontics";
  }
  if (action === "periodontics") {
    return group === "various";
  }
  if (action === "extraction") {
    return group === "surgery";
  }
  if (action === "mobileProsthesis") {
    return value.includes("protesi mobile");
  }
  return group === "prosthesis" && !value.includes("protesi mobile");
}
