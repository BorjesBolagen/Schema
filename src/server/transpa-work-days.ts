import "server-only";
import type { WorkDayProvider, WorkDayResult } from "@/lib/work-days";

/**
 * Arbetsdagar från TransPA.
 *
 * Ännu inte byggd, och medvetet inte gissad. Vilken endpoint som gäller
 * — eller om någon finns — avgörs av diagnostiksidan under /transpa, som
 * frågar er tenant direkt. Först när den visar ett svar går det att
 * skriva den här mot något verkligt.
 *
 * Tills dess ligger den inte i kedjan alls: getWorkDayProvider() lämnar
 * över till LocalPatternProvider, och den dagen den här tas i bruk läggs
 * den först i CompositeWorkDayProvider. Övergången sker då person för
 * person, eftersom composite faller tillbaka på mönstret för dem TransPA
 * inte har besked om.
 */
export class TranspaWorkDayProvider implements WorkDayProvider {
  readonly name = "TransPA";

  async getWorkDays(): Promise<WorkDayResult> {
    throw new Error(
      "TransPA-hämtningen är inte byggd. Kör diagnostiken under /transpa för att ta reda på " +
        "vilken endpoint som ger planerade pass, så kan den skrivas mot den.",
    );
  }
}
