import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import pkg from '@prisma/client';

const { PrismaClient } = pkg;
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;

// Force IPv4 connection
const pool = new Pool({
    connectionString,
    ssl: {
        rejectUnauthorized: false
    }
});

// Override DNS resolution to use IPv4 only
pool.options.host = 'db.dkkecqqmvycpyicxgzqk.supabase.co';
pool.options.family = 4; // Force IPv4

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export default prisma;
