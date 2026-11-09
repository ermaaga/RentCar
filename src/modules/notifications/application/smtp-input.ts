import { z } from "zod";

// NTF-01 input (docs/06-backend-api.md): a blank password keeps the stored one. The host is only
// shape-checked here; the SSRF guard (resolve and validate) runs in the service.
const headerSafe = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !/[\r\n\0]/.test(v), "control characters are not allowed");

export const smtpSettingsInput = z.object({
  host: headerSafe(253).pipe(z.string().min(1)),
  port: z.coerce
    .number()
    .pipe(z.union([z.literal(25), z.literal(465), z.literal(587), z.literal(2525)])),
  security: z.enum(["tls", "starttls"]),
  username: headerSafe(254).pipe(z.string().min(1)),
  password: z.string().max(1024).optional(),
  fromAddress: z.email().max(254),
  fromName: headerSafe(80).optional(),
});

export type SmtpSettingsInput = z.infer<typeof smtpSettingsInput>;
