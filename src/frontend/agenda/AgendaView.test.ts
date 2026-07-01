import { describe, expect, it } from "vitest";
import { agendaDateUtilsForTests, isValidDateInput } from "./AgendaView";

describe("agenda date input safety", () => {
  it("rejects incomplete and impossible manual date values", () => {
    expect(isValidDateInput("")).toBe(false);
    expect(isValidDateInput("2026-06-0")).toBe(false);
    expect(isValidDateInput("2026-02-31")).toBe(false);
    expect(isValidDateInput("2026-06-08")).toBe(true);
  });

  it("keeps agenda helpers safe when a date input emits an empty value", () => {
    expect(() => agendaDateUtilsForTests.formatDayLabel("")).not.toThrow();
    expect(() => agendaDateUtilsForTests.shiftDate("", 1)).not.toThrow();
    expect(agendaDateUtilsForTests.agendaRange("", "day").startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
