const oddValues: Record<string, number> = {
  "0": 1,
  "1": 0,
  "2": 5,
  "3": 7,
  "4": 9,
  "5": 13,
  "6": 15,
  "7": 17,
  "8": 19,
  "9": 21,
  A: 1,
  B: 0,
  C: 5,
  D: 7,
  E: 9,
  F: 13,
  G: 15,
  H: 17,
  I: 19,
  J: 21,
  K: 2,
  L: 4,
  M: 18,
  N: 20,
  O: 11,
  P: 3,
  Q: 6,
  R: 8,
  S: 12,
  T: 14,
  U: 16,
  V: 10,
  W: 22,
  X: 25,
  Y: 24,
  Z: 23
};

const validMonthCodes = new Set(["A", "B", "C", "D", "E", "H", "L", "M", "P", "R", "S", "T"]);

export function normalizeTaxCode(taxCode: string) {
  return taxCode.trim().toUpperCase();
}

export function isValidItalianTaxCode(taxCode: string) {
  const normalized = normalizeTaxCode(taxCode);

  if (!/^[A-Z0-9]{16}$/.test(normalized)) {
    return false;
  }

  const chars = normalized.split("");
  if (!chars.slice(0, 6).every((character) => /[A-Z]/.test(character))) {
    return false;
  }

  if (!validMonthCodes.has(chars[8]) || !/[A-Z]/.test(chars[11]) || !/[A-Z]/.test(chars[15])) {
    return false;
  }

  const checksum = chars.slice(0, 15).reduce((sum, character, index) => {
    if (index % 2 === 0) {
      return sum + oddValues[character];
    }

    if (/[0-9]/.test(character)) {
      return sum + Number(character);
    }

    return sum + character.charCodeAt(0) - 65;
  }, 0);

  return String.fromCharCode(65 + (checksum % 26)) === chars[15];
}
