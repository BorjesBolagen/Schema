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
 *
 * alt går att skriva över: när märket bara är dekor — som det nedsänkta
 * lodjuret i inloggningens bakgrund — ska det vara tomt, annars läser
 * skärmläsaren upp "Börjes" en extra gång.
 */
export function Lodjur({
  className = "h-6",
  alt = "Börjes",
  ...rest
}: { className?: string } & Omit<React.ComponentPropsWithoutRef<"img">, "src" | "className">) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/lodjur.svg" alt={alt} className={className} {...rest} />
  );
}
