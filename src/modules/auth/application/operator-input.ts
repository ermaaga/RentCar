import { z } from "zod";

// AUT-12 input (docs/06-backend-api.md): the username follows the users table rule after lowercasing.
const noControl = (v: string) => !/[\r\n\0]/.test(v);

export const createOperatorInput = z.object({
  displayName: z.string().trim().min(1).max(120).refine(noControl),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,64}$/),
  email: z.email().max(254),
});
