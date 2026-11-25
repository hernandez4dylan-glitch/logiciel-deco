import { describe, expect, it } from "vitest";
import { parseAmount } from "./format";

describe("parseAmount", () => {
  it("lit les montants à la française", () => {
    expect(parseAmount("38,50")).toBe(38.5);
    expect(parseAmount("1 200,5 €")).toBe(1200.5);
    expect(parseAmount("1 200,00")).toBe(1200);
    expect(parseAmount("12.3456")).toBe(12.35);
  });
  it("refuse les saisies illisibles", () => {
    expect(parseAmount("")).toBeNaN();
    expect(parseAmount("abc")).toBeNaN();
    expect(parseAmount("-5")).toBeNaN();
    expect(parseAmount("1,2,3")).toBeNaN();
  });
});
