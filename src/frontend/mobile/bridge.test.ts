import { describe, expect, it } from "vitest";
import { calculateBridgePreview } from "./bridge";

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
});
