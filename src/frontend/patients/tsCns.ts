import type { TsCnsPatientData } from "./patientsApi";

const tags = {
  lastName: "5f20",
  firstName: "5f21",
  dateOfBirth: "5f24",
  taxCode: "5f25"
} as const;

export function parseTsCnsTlv(payload: Uint8Array): TsCnsPatientData {
  const values = parseTlv(payload);
  return {
    last_name: requiredText(values, tags.lastName),
    first_name: requiredText(values, tags.firstName),
    date_of_birth: normalizeBirthDate(requiredText(values, tags.dateOfBirth)),
    tax_code: requiredText(values, tags.taxCode).toUpperCase()
  };
}

function parseTlv(payload: Uint8Array) {
  const values = new Map<string, Uint8Array>();
  let index = 0;
  while (index < payload.length) {
    if (payload[index] === 0x00 || payload[index] === 0xff) {
      index += 1;
      continue;
    }
    const tagStart = index;
    index += 1;
    if ((payload[tagStart] & 0x1f) === 0x1f) {
      while (index < payload.length) {
        const byte = payload[index];
        index += 1;
        if ((byte & 0x80) === 0) {
          break;
        }
      }
    }
    const tag = toHex(payload.slice(tagStart, index));
    if (index >= payload.length) {
      throw new Error("TS-CNS TLV length missing");
    }
    const firstLength = payload[index];
    index += 1;
    const length = (firstLength & 0x80) === 0 ? firstLength : readLongLength(payload, firstLength, () => index, (next) => { index = next; });
    if (index + length > payload.length) {
      throw new Error("TS-CNS TLV value truncated");
    }
    values.set(tag, payload.slice(index, index + length));
    index += length;
  }
  return values;
}

function readLongLength(payload: Uint8Array, firstLength: number, getIndex: () => number, setIndex: (index: number) => void) {
  const lengthBytes = firstLength & 0x7f;
  if (lengthBytes === 0 || lengthBytes > 2) {
    throw new Error("TS-CNS TLV long length unsupported");
  }
  const index = getIndex();
  if (index + lengthBytes > payload.length) {
    throw new Error("TS-CNS TLV long length truncated");
  }
  let value = 0;
  for (let offset = 0; offset < lengthBytes; offset += 1) {
    value = (value << 8) | payload[index + offset];
  }
  setIndex(index + lengthBytes);
  return value;
}

function requiredText(values: Map<string, Uint8Array>, tag: string) {
  const value = values.get(tag);
  if (!value) {
    throw new Error(`TS-CNS tag ${tag} missing`);
  }
  return new TextDecoder().decode(value).trim();
}

function normalizeBirthDate(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }
  if (digits.length === 6) {
    const prefix = digits.slice(0, 2) > "30" ? "19" : "20";
    return `${prefix}${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`;
  }
  throw new Error("TS-CNS birth date invalid");
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
