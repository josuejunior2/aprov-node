import { z } from "zod";

export const roleSchema = z.enum(["SUPER_ADMIN", "AGENT"]);
export type Role = z.infer<typeof roleSchema>;