export interface BridgePreview {
  selectedTeeth: number[];
  includedTeeth: number[];
  unitCount: number;
}

export function calculateBridgePreview(selectedTeeth: number[]): BridgePreview | null {
  const selected = Array.from(new Set(selectedTeeth)).sort((left, right) => left - right);
  if (selected.length < 2) {
    return null;
  }
  const quadrant = Math.floor(selected[0] / 10);
  if (!selected.every((tooth) => Math.floor(tooth / 10) === quadrant && tooth % 10 >= 1 && tooth % 10 <= 8)) {
    return null;
  }
  const positions = selected.map((tooth) => tooth % 10);
  const min = Math.min(...positions);
  const max = Math.max(...positions);
  const includedTeeth = Array.from({ length: max - min + 1 }, (_, index) => quadrant * 10 + min + index);
  return {
    selectedTeeth: selected,
    includedTeeth,
    unitCount: includedTeeth.length
  };
}
