import { z } from "zod";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export const isoDateSchema = z.string().regex(isoDatePattern, "Datum muss YYYY-MM-DD sein");

export class ValidationError extends Error {
  public readonly status = 400;
  public readonly details: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = "ValidationError";
    this.details = details;
  }
}

export function validateQuery<TSchema extends z.ZodTypeAny>(schema: TSchema, input: unknown): z.infer<TSchema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError("Ungültige Query-Parameter", parsed.error.flatten());
  }
  return parsed.data;
}

export function withValidDateRange<TSchema extends z.ZodObject<any>>(schema: TSchema) {
  return schema.refine((value) => !(value.from && value.to) || value.from <= value.to, {
    message: "from darf nicht nach to liegen",
    path: ["from"],
  });
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
