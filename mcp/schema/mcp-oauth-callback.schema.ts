import { z } from 'zod';

export const McpOAuthCallbackSchema = z.object({
  code: z.string().trim().min(1, { message: 'Authorization code is required' }),
  state: z.string().trim().min(1, { message: 'State is required' }),
});
