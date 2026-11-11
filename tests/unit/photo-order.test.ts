import { describe, expect, it } from "vitest";

import { isPermutation, moveTo, parseOrderedIds } from "../../src/modules/fleet/domain/photo-order";

// FLT-08 order rules (docs/06-backend-api.md): list shape, permutation check and moves.
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";

describe("parseOrderedIds", () => {
  it("accepts up to 10 uuids and lowercases them", () => {
    expect(parseOrderedIds([A.toUpperCase(), B])).toEqual([A, B]);
  });

  it("rejects anything else", () => {
    for (const value of [null, "x", [], [A, 1], [A, "not-a-uuid"], Array(11).fill(A)]) {
      expect(parseOrderedIds(value)).toBeNull();
    }
  });
});

describe("isPermutation", () => {
  it("is true only for the same ids each once", () => {
    expect(isPermutation([A, B, C], [C, A, B])).toBe(true);
    expect(isPermutation([A, B], [A])).toBe(false);
    expect(isPermutation([A, B], [A, A])).toBe(false);
    expect(isPermutation([A, B], [A, C])).toBe(false);
  });
});

describe("moveTo", () => {
  it("moves an item to any position", () => {
    expect(moveTo([A, B, C], 2, 0)).toEqual([C, A, B]);
    expect(moveTo([A, B, C], 0, 2)).toEqual([B, C, A]);
    expect(moveTo([A, B, C], 1, 1)).toEqual([A, B, C]);
  });

  it("returns null for an index out of range or not an integer", () => {
    expect(moveTo([A, B], -1, 0)).toBeNull();
    expect(moveTo([A, B], 0, 2)).toBeNull();
    expect(moveTo([A, B], 0, Number.NaN)).toBeNull();
    expect(moveTo([A, B], 0, 0.5)).toBeNull();
  });
});
