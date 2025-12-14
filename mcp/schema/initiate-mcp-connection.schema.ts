import { z } from 'zod';

export const InitiateMcpConnectionSchema = z.object({
  serverSlug: z
    .string()
    .trim()
    .min(1, { message: 'Server slug is required' })
    .max(100, { message: 'Server slug is too long' }),
});
