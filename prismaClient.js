import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import pkg from '@prisma/client';
import dns from 'dns';
import { promisify } from 'util';

const { PrismaClient } = pkg;
import dotenv from 'dotenv';

dotenv.config();

const resolve4 = promisify(dns.resolve4);

// Function to get IPv4 address only
async function getIPv4Address(hostname) {
    try {
        // Use Cloudflare DNS (1.1.1.1) which prefers IPv4
        dns.setServers(['1.1.1.1', '8.8.8.8']);
        const addresses = await resolve4(hostname);
        console.log(`Resolved ${hostname} to IPv4: ${addresses[0]}`);
        return addresses[0];
    } catch (error) {
        console.error(`Failed to resolve IPv4 for ${hostname}:`, error.message);
        throw error;
    }
}

// Parse DATABASE_URL and replace hostname with IPv4
async function createPool() {
    const connectionString = process.env.DATABASE_URL;

    // Extract hostname from connection string
    const url = new URL(connectionString);
    const hostname = url.hostname;

    // Get IPv4 address
    const ipv4 = await getIPv4Address(hostname);

    // Replace hostname with IP
    url.hostname = ipv4;
    const ipv4ConnectionString = url.toString();

    console.log(`Connecting to PostgreSQL via IPv4: ${ipv4}`);

    return new Pool({
        connectionString: ipv4ConnectionString,
        ssl: {
            rejectUnauthorized: false
        }
    });
}

// Initialize pool asynchronously
let prisma;
async function initializePrisma() {
    const pool = await createPool();
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });
    return prisma;
}

// Export a promise that resolves to prisma
const prismaPromise = initializePrisma();

export default prismaPromise;
