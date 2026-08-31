/**
 * Spärren mot att skriva i skarp drift av misstag.
 *
 * TransPA-tenanten är Börjes produktionsmiljö. Ett felaktigt anrop
 * flyttar en riktig chaufförs pass, och det märks först när någon kör
 * fel — eller inte kör alls.
 *
 * Därför skrivs det bara till en tillåtelselista, och listan innehåller
 * en enda person: Prov, som finns just för det här. Spärren ligger i
 * koden och inte i disciplinen, eftersom disciplin inte överlever en
 * stressig fredag.
 *
 * Listan öppnas när Johan säger till, inte när den känns onödig.
 */

/** Prov Provsson i Börjes tenant — testpersonen skrivningar får röra. */
export const TEST_EMPLOYEE_ID = "99e981d1-f24d-40a6-9212-96730d9afaa9";

export class WriteNotAllowedError extends Error {
  constructor(readonly transpaEmployeeId: string) {
    super(
      `Skrivning stoppad: ${transpaEmployeeId} står inte på tillåtelselistan. ` +
        "Bara testpersonen får skrivas till tills skrivvägen är bevisad.",
    );
    this.name = "WriteNotAllowedError";
  }
}

/**
 * Vilka TransPA-personer som får skrivas till.
 *
 * En funktion och inte en konstant, så listan kan vidgas på ett ställe
 * när den ska vidgas — och så att den går att läsa av i ett test.
 */
export function allowedWriteTargets(): string[] {
  return [TEST_EMPLOYEE_ID];
}

export function mayWriteTo(transpaEmployeeId: string | null | undefined): boolean {
  return !!transpaEmployeeId && allowedWriteTargets().includes(transpaEmployeeId);
}

/**
 * Kastar om personen inte får skrivas till.
 *
 * Anropas innan anropet byggs, inte efter — poängen är att inget ska
 * lämna maskinen, inte att felet ska rapporteras snyggt.
 */
export function assertMayWriteTo(transpaEmployeeId: string | null | undefined): void {
  if (!mayWriteTo(transpaEmployeeId)) {
    throw new WriteNotAllowedError(transpaEmployeeId ?? "(okänd)");
  }
}
