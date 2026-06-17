import { describe, expect, it } from "vitest";
import { translations } from "./translations";

describe("VeloDent localization catalog", () => {
  it("keeps Italian and English catalogs aligned", () => {
    expect(Object.keys(translations.en).sort()).toEqual(Object.keys(translations.it).sort());
  });
});

