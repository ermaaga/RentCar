// Session cookies (docs/06-backend-api.md 4.1, SR-SES): one per realm, HttpOnly, no Domain, no Max-Age.
// `Secure` and the `__Host-` prefix are dropped only for local development over http://localhost.

export type CookieRealm = "tenant" | "system";

export interface SessionCookieSpec {
  name: string;
  options: {
    httpOnly: true;
    secure: boolean;
    sameSite: "lax" | "strict";
    path: "/";
  };
}

export function sessionCookie(realm: CookieRealm, secure: boolean): SessionCookieSpec {
  const base = realm === "tenant" ? "rc_tenant" : "rc_system";
  return {
    name: secure ? `__Host-${base}` : base,
    options: {
      httpOnly: true,
      secure,
      sameSite: realm === "tenant" ? "lax" : "strict",
      path: "/",
    },
  };
}

/** Secure cookies everywhere except local development served over plain http. */
export function cookiesMustBeSecure(appEnv: string, baseUrl: string): boolean {
  return !(appEnv === "local" && baseUrl.startsWith("http://"));
}
