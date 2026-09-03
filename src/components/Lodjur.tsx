/**
 * Börjes lodjur.
 *
 * Konturerna ritas i currentColor så märket följer texten det står
 * bredvid — svart på vitt, vitt på svart, utan en andra fil. Ögonen är
 * märkesgula och står fast: det är det enda i loggan som har en egen
 * färg, och den ska inte byta med sammanhanget.
 *
 * Kommer från CMYKlodjur.pdf, beskuren till konturens omslutande låda —
 * originalet ligger mitt på en A4-sida, och med den vidden hade märket
 * blivit en prick med luft runt.
 */
export function Lodjur({ className = "h-6" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/lodjur.svg" alt="Börjes" className={className} />
  );
}
