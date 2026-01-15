import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import pkg from '@prisma/client';

const { PrismaClient } = pkg;
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;

// Force IPv4 by parsing the connection string and setting host explicitly
const pool = new Pool({
    connectionString,
    // Force IPv4 resolution
    host: 'db.dkkecqqmvycpyicxgzqk.supabase.co',
    connectionTimeoutMillis: 10000,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export default prisma;
