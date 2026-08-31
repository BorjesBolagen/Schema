import { describe, expect, it } from "vitest";
import {
  allowedWriteTargets,
  assertMayWriteTo,
  mayWriteTo,
  TEST_EMPLOYEE_ID,
  WriteNotAllowedError,
} from "./write-guard";

/**
 * Spärren är det enda som står mellan en bugg och en riktig chaufförs
 * schema. Den provas därför hårdare än den ser ut att behöva.
 */
describe("write-guard", () => {
  it("släpper igenom testpersonen", () => {
    expect(mayWriteTo(TEST_EMPLOYEE_ID)).toBe(true);
    expect(() => assertMayWriteTo(TEST_EMPLOYEE_ID)).not.toThrow();
  });

  it("stoppar alla andra", () => {
    for (const id of [
      "40e6783e-af1a-4d48-84da-f07b4f65f834", // en riktig chaufför
      "3bfec2f0-0989-404f-8545-30ebeb9b4b38",
      "",
      null,
      undefined,
    ]) {
      expect(mayWriteTo(id)).toBe(false);
      expect(() => assertMayWriteTo(id)).toThrow(WriteNotAllowedError);
    }
  });

  /* Listan ska vara kort och medvetet kort. Växer den utan att någon
     bett om det ska testet säga ifrån. */
  it("innehåller bara testpersonen", () => {
    expect(allowedWriteTargets()).toEqual([TEST_EMPLOYEE_ID]);
  });

  it("säger vem som stoppades, så felet går att förstå", () => {
    try {
      assertMayWriteTo("nagon-annan");
      throw new Error("skulle ha kastat");
    } catch (e) {
      expect(e).toBeInstanceOf(WriteNotAllowedError);
      expect((e as WriteNotAllowedError).message).toContain("nagon-annan");
    }
  });
});
