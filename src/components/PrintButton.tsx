"use client";

/**
 * Utskrift och PDF.
 *
 * Webbläsarens egen utskrift används i stället för en genererad fil:
 * sidan har redan en utskriftslayout, och "Spara som PDF" i dialogen ger
 * exakt det som syns på skärmen — samma layout trafikansvarig byggt.
 */
export function PrintButton({
  label = "Skriv ut / PDF",
  /* Utseendet kommer utifrån. I tavlans sidhuvud står utskriften bland
     de tysta uttagen och ska inte se ut som ett reglage; på
     semestersidan står den ensam och får vara en knapp. */
  className = "rounded border border-(--color-line) bg-white px-3 py-1.5 text-sm",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <button type="button" onClick={() => window.print()} className={className}>
      {label}
    </button>
  );
}
