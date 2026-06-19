import { describe, expect, it } from "vitest";
import { isValidItalianTaxCode, normalizeTaxCode } from "./taxCode";

describe("italian tax code validation", () => {
  it("normalizes and validates the checksum", () => {
    expect(normalizeTaxCode(" rssmra85m01h501q ")).toBe("RSSMRA85M01H501Q");
    expect(isValidItalianTaxCode("RSSMRA85M01H501Q")).toBe(true);
    expect(isValidItalianTaxCode("RSSMRA85M01H501Z")).toBe(false);
  });
});
