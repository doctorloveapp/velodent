import { describe, expect, it } from "vitest";
import { parseHealthCardText } from "./MobileOcrScanner";

describe("parseHealthCardText", () => {
  it("extracts health card fields from labelled OCR text", () => {
    const parsed = parseHealthCardText(`
      TESSERA SANITARIA
      COGNOME
      ROSSI
      NOME
      MARIO
      CODICE FISCALE RSSMRA80A01H501U
      DATA NASCITA 01/01/1980
    `);

    expect(parsed).toEqual({
      date_of_birth: "1980-01-01",
      first_name: "MARIO",
      last_name: "ROSSI",
      tax_code: "RSSMRA80A01H501U"
    });
  });

  it("uses the tax code birth date when OCR misses the explicit date", () => {
    const parsed = parseHealthCardText(`
      ROSSI
      MARIO
      RSSMRA80A01H501U
    `);

    expect(parsed.date_of_birth).toBe("1980-01-01");
  });
});
