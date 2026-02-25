import { z } from "zod";

export function formDataString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function parseServerActionForm<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown
): { ok: true; data: z.output<TSchema> } | { ok: false; error: z.ZodError<z.input<TSchema>> } {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error };
  }
  return { ok: true, data: parsed.data };
}

export const zFormBooleanString = z.enum(["true", "false"]).transform((value) => value === "true");
