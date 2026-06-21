import { describe, expect, it } from "vitest";
import { calculateBridgePreview, calculateProsthesisLine } from "./bridge";

describe("mobile bridge preview", () => {
  it("includes intermediate teeth between selected units", () => {
    expect(calculateBridgePreview([14, 16])).toEqual({
      selectedTeeth: [14, 16],
      includedTeeth: [14, 15, 16],
      unitCount: 3
    });
  });

  it("rejects selections across different quadrants", () => {
    expect(calculateBridgePreview([14, 24])).toBeNull();
  });

  it("returns a single-tooth prosthesis ring for one selected tooth", () => {
    expect(calculateProsthesisLine([14])).toEqual({ tooth: 14, type: "single" });
  });

  it("returns a bridge prosthesis line for multiple selected teeth", () => {
    expect(calculateProsthesisLine([14, 16])).toEqual({
      includedTeeth: [14, 15, 16],
      selectedTeeth: [14, 16],
      type: "bridge",
      unitCount: 3
    });
  });
});
