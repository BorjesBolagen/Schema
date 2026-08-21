"use client";

/**
 * Utskrift och PDF.
 *
 * Webbläsarens egen utskrift används i stället för en genererad fil:
 * sidan har redan en utskriftslayout, och "Spara som PDF" i dialogen ger
 * exakt det som syns på skärmen — samma layout trafikansvarig byggt.
 */
export function PrintButton({ label = "Skriv ut / PDF" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded border border-(--color-line) bg-white px-3 py-1.5 text-sm"
    >
      {label}
    </button>
  );
}
