import { z } from "zod/v4";

export const RequestUploadUrlBody = z.object({
  name: z.string(),
  size: z.coerce.number(),
  contentType: z.string(),
});
export type RequestUploadUrlBody = z.infer<typeof RequestUploadUrlBody>;

export const RequestUploadUrlResponse = z.object({
  uploadURL: z.string(),
  objectPath: z.string(),
  metadata: z
    .object({
      name: z.string(),
      size: z.number().nullable().optional(),
      contentType: z.string(),
    })
    .optional(),
});
export type RequestUploadUrlResponse = z.infer<typeof RequestUploadUrlResponse>;
