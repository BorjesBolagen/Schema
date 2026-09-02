/**
 * Antal plus substantiv, med rätt form.
 *
 * "1 personer utan bil" stod i tavlans besked, och den sortens fel
 * märks: det ser ut som att programmet räknar men inte läser. Formerna
 * skrivs ut på anropsstället eftersom svenskan inte har en regel att
 * härleda dem ur — person/personer, rad/rader, pass/pass.
 */
export function antal(n: number, ental: string, flertal: string): string {
  return `${n} ${n === 1 ? ental : flertal}`;
}
