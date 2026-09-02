import { describe, expect, it } from "vitest";
import { antal } from "./plural";

describe("antal", () => {
  it("väljer ental vid ett", () => {
    expect(antal(1, "person", "personer")).toBe("1 person");
  });

  it("väljer flertal vid noll och flera", () => {
    expect(antal(0, "person", "personer")).toBe("0 personer");
    expect(antal(2, "person", "personer")).toBe("2 personer");
  });

  /* Ord som ser likadana ut i båda formerna ska också gå att skriva. */
  it("klarar oräknebara former", () => {
    expect(antal(1, "pass", "pass")).toBe("1 pass");
    expect(antal(7, "pass", "pass")).toBe("7 pass");
  });
});
