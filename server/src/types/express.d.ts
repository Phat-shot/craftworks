import type { Pool } from 'pg';

// Augments Express's Request with the properties this codebase actually
// attaches at runtime — req.user (middleware/auth.js's requireAuth) and
// req.db (index.js's injectDb middleware, used by routes/brands.js and
// routes/workshop*.js). Shared across every file that opts into type
// checking, not just the auth.js pilot.
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email?: string;
        username: string;
        language?: string;
        avatar_color?: string;
        email_verified?: boolean;
        is_guest?: boolean;
        is_admin?: boolean;
        is_creator?: boolean;
      };
      db?: Pool;
    }
  }
}

export {};
