/**
 * Kakans namn, brutet ur auth.ts så mellanvaran kan importera det utan
 * att dra in databasdrivrutinerna — de fungerar inte på Edge.
 */
export const SESSION_COOKIE = "schema_session";
