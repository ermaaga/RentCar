// Fixture: parameterised SQL, constant fetch URL, no banned APIs. Must produce zero findings.
export async function safeQuery(
  pool: { query: (s: string, p: unknown[]) => Promise<unknown> },
  id: string,
) {
  return pool.query("SELECT * FROM bookings WHERE id = $1", [id]);
}

export async function health() {
  return fetch("https://example.test/health");
}
