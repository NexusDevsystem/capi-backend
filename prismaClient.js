/**
 * Database Client
 * Now using Supabase REST API instead of direct PostgreSQL connection
 * This avoids IPv6 connectivity issues on Render
 */
import db from './supabaseDb.js';

// Re-export the Supabase database wrapper as 'prisma' for compatibility
export default db;
