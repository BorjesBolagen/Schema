/**
 * Lösenordskrav.
 *
 * Egen modul utan Node-beroenden, eftersom både inloggningsformulären i
 * webbläsaren och servern använder samma regel. Hashningen ligger i
 * password.ts och hör bara hemma på servern.
 *
 * Längd väger tyngre än teckenkrav, som mest driver folk mot
 * "Sommar2026!" — långt och eget slår kort och krångligt.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < 12) return "Lösenordet måste vara minst 12 tecken.";
  if (/^\s|\s$/.test(password)) return "Lösenordet får inte börja eller sluta med blanksteg.";
  if (new Set(password).size < 5) return "Lösenordet är för enformigt.";
  return null;
}
