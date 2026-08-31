import { describe, expect, it } from "vitest";
import { groupWrites, topicOf, writeVerdict } from "./write-paths";

/**
 * Slutsatsen "TransPA har ingen skrivväg" har hittills varit en
 * gissning, byggd på att spec-läsningen kastade bort allt utom GET. Det
 * här är maskineriet som ska ge ett svar i stället — och det får inte
 * självt gissa fel om vad en väg rör.
 */
describe("topicOf", () => {
  /* Ordningen spelar roll: passvägen ligger under en person, men den
     handlar om pass. */
  it("läser en persons passväg som pass, inte som personal", () => {
    expect(topicOf("/v1/employees/{id}/shifts/")).toBe("shifts");
  });

  it("känner igen de fyra områdena", () => {
    expect(topicOf("/v1/shifts/")).toBe("shifts");
    expect(topicOf("/v1/absences")).toBe("absence");
    expect(topicOf("/v1/employees")).toBe("employees");
    expect(topicOf("/v1/vehicles/{id}")).toBe("vehicles");
    expect(topicOf("/v1/workTasks")).toBe("other");
  });

  it("tar frånvaro på flera stavningar", () => {
    for (const p of ["/v1/leave", "/v1/vacations", "/v1/absence/{id}"]) {
      expect(topicOf(p)).toBe("absence");
    }
  });
});

describe("writeVerdict", () => {
  it("säger nej när det inte finns någon skrivväg", () => {
    expect(writeVerdict([])).toEqual({ shifts: false, absence: false, total: 0 });
  });

  it("säger ja för pass när det går att skapa ett", () => {
    const v = writeVerdict([{ path: "/v1/shifts/", method: "POST" }]);
    expect(v.shifts).toBe(true);
    expect(v.absence).toBe(false);
  });

  /* Att kunna ta bort ett pass utan att kunna skapa ett är ingen
     skrivväg för en flytt — då blir resultatet att passet försvinner. */
  it("räknar inte DELETE ensamt som en skrivväg", () => {
    expect(writeVerdict([{ path: "/v1/shifts/{id}", method: "DELETE" }]).shifts).toBe(false);
  });

  it("räknar PUT och PATCH som skrivvägar", () => {
    expect(writeVerdict([{ path: "/v1/shifts/{id}", method: "PUT" }]).shifts).toBe(true);
    expect(writeVerdict([{ path: "/v1/absences/{id}", method: "PATCH" }]).absence).toBe(true);
  });
});

describe("groupWrites", () => {
  it("ställer pass och frånvaro först", () => {
    const grupper = groupWrites([
      { path: "/v1/vehicles", method: "POST" },
      { path: "/v1/absences", method: "POST" },
      { path: "/v1/shifts/", method: "POST" },
    ]);
    expect(grupper.map((g) => g.topic)).toEqual(["shifts", "absence", "vehicles"]);
  });

  it("utelämnar områden utan skrivvägar", () => {
    expect(groupWrites([{ path: "/v1/shifts/", method: "POST" }]).map((g) => g.topic)).toEqual([
      "shifts",
    ]);
  });
});
