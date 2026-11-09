import { z } from "zod";

// Input of NTF-01 saveSmtpSettings (docs/06-backend-api.md 6.x). A blank password keeps the stored one.

export const SMTP_PORTS = [587, 465, 2525, 25] as const;

export const smtpSettingsInput = z
  .object({
    host: z.string().trim().toLowerCase().min(1).max(255),
    port: z.coerce
      .number()
      .int()
      .refine((p) => (SMTP_PORTS as readonly number[]).includes(p)),
    security: z.enum(["starttls", "tls"]),
    username: z.string().trim().min(1).max(254),
    password: z.string().max(256),
    fromAddress: z.email().max(254),
    fromName: z.string().trim().max(120),
    expectedUpdatedAt: z.string().max(40),
  })
  .strict();

export type SmtpSettingsInput = z.infer<typeof smtpSettingsInput>;
