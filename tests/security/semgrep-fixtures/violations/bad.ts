// Fixture: every line below must be reported by a rule in .semgrep/rentcar.yml.
export async function unsafeQuery(pool: { query: (s: string) => Promise<unknown> }, id: string) {
  return pool.query(`SELECT * FROM bookings WHERE id = '${id}'`);
}

export const html = (userText: string) => ({ dangerouslySetInnerHTML: { __html: userText } });

export const run = (code: string) => eval(code);

export async function ssrf(target: string) {
  return fetch(target);
}
