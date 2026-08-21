import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";
import { passwordProblem } from "./password-rules";

describe("lösenord", () => {
  it("verifierar rätt lösenord", async () => {
    const hash = await hashPassword("höstlöv-42");
    expect(await verifyPassword("höstlöv-42", hash)).toBe(true);
  });

  it("avvisar fel lösenord", async () => {
    const hash = await hashPassword("höstlöv-42");
    expect(await verifyPassword("höstlöv-43", hash)).toBe(false);
  });

  it("ger olika hash varje gång tack vare saltet", async () => {
    expect(await hashPassword("samma")).not.toBe(await hashPassword("samma"));
  });

  it("normaliserar unicode så samma tecken alltid matchar", async () => {
    // "ö" kan skrivas som ett tecken eller som o + kombinerande diakrit.
    const hash = await hashPassword("lösenord");
    expect(await verifyPassword("lösenord", hash)).toBe(true);
  });

  it("avvisar användare utan lösenord och trasiga hashar", async () => {
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "inte-en-hash")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$1$2$3$4$5")).toBe(false);
  });
})

describe("passwordProblem", () => {
  it("kräver längd framför teckenkrångel", () => {
    expect(passwordProblem("Kort1!")).toMatch(/minst 12/);
    expect(passwordProblem("hästar över ängen")).toBeNull();
  });

  it("avvisar enformiga lösenord", () => {
    expect(passwordProblem("aaaaaaaaaaaaaaaa")).toMatch(/enformigt/);
  });

  it("avvisar inledande och avslutande blanksteg", () => {
    expect(passwordProblem(" hästar över ängen")).toMatch(/blanksteg/);
    expect(passwordProblem("hästar över ängen ")).toMatch(/blanksteg/);
  });
});
