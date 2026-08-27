import { type Db } from "@/db";
import { CompositeWorkDayProvider, type WorkDayProvider } from "@/lib/work-days";
import { SyncedShiftProvider } from "./shift-provider";

/**
 * Källan appen läser arbetsdagar ur.
 *
 * De synkade passen från TransPA, och inget annat. De lokala
 * arbetsmönstren är borttagna: TransPA vet vem som jobbar när, och två
 * källor att hålla i synk var precis det dubbelarbete verktyget skulle
 * ta bort.
 *
 * Composite står kvar runt den enda källan — en reserv kan behöva
 * läggas till igen, och då ska den kunna falla tillbaka per person i
 * stället för som ett omkast.
 */
export function getWorkDayProvider(db?: Db): WorkDayProvider {
  return new CompositeWorkDayProvider([new SyncedShiftProvider(db)]);
}
