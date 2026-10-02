import { z } from "zod";

export const RedmineAttachmentSchema = z.object({
  id: z.number(),
  filename: z.string(),
  filesize: z.number(),
  content_type: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  content_url: z.string().optional(),
  thumbnail_url: z.string().optional(),
  author: z.object({
    id: z.number(),
    name: z.string(),
  }).optional(),
  created_on: z.string().optional(),
});
