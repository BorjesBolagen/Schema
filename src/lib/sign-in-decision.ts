/**
 * Vad inloggningen ska svara.
 *
 * Bruten ur auth.ts av två skäl. Reglerna här är hela skillnaden mellan
 * en inloggning och en kartläggningstjänst, och de ska gå att pröva —
 * inte kontrolleras genom att läsa källkoden. Och auth.ts drar in
 * next/navigation och därmed React, vilket gör modulen omöjlig att
 * importera i ett test utan att starta en renderare.
 *
 * Ingen databas, inga kakor, ingen klocka utom den man skickar in.
 */

export type SignInDecision =
  | { kind: "ok" }
  | { kind: "locked"; minutes: number }
  | { kind: "inactive" }
  | { kind: "denied" };

export function decideSignIn(input: {
  /** Fanns kontot? */
  finns: boolean;
  /** Stämde lösenordet? Falskt även när kontot inte fanns. */
  passwordOk: boolean;
  lockedUntil: Date | null;
  isActive: boolean;
  now?: number;
}): SignInDecision {
  const nu = input.now ?? Date.now();
  const spärrad = Boolean(input.lockedUntil && input.lockedUntil.getTime() > nu);

  /* Spärren och avstängningen nämns bara för den som gett rätt
     lösenord.

     Att alltid säga "kontot är spärrat" gjorde spärren till en
     kartläggningstjänst: åtta felförsök mot en gissad adress, och
     meddelandet skvallrade om adressen var ett riktigt konto. Att
     aldrig säga det lämnar däremot en riktig användare att gissa varför
     rätt lösenord inte fungerar.

     Rätt lösenord bevisar att man äger kontot, och då läcker beskedet
     ingenting. Fel lösenord ger samma svar som allt annat. */
  if (input.finns && input.passwordOk) {
    if (spärrad) {
      return { kind: "locked", minutes: Math.ceil((input.lockedUntil!.getTime() - nu) / 60_000) };
    }
    if (!input.isActive) return { kind: "inactive" };
    return { kind: "ok" };
  }
  return { kind: "denied" };
}
