
import dotenv from 'dotenv';
import { createRequire } from 'module';

dotenv.config();
const require = createRequire(import.meta.url); // verify-backend logic uses fetch but let's stick to standard node if needed, actually fetch is global in 18+

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // Anon Key

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Error: SUPABASE_URL or SUPABASE_KEY not found in .env');
    process.exit(1);
}

async function verifyRLS() {
    console.log('🔒 Verifying Row Level Security (RLS)...\n');

    // 1. Test Public Access (Anon Key) -> Should be BLOCKED (Empty Array)
    console.log(`1. Testing Public Access via Supabase REST API...`);
    console.log(`   Target: ${SUPABASE_URL}/rest/v1/users?select=*`);

    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/users?select=*`, {
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.log(`   Response Status: ${response.status} ${response.statusText}`);
            // 401/403 is also good, but usually RLS returns 200 with empty array for SELECT if no policy matches
        }

        const data = await response.json();

        if (Array.isArray(data)) {
            if (data.length === 0) {
                console.log('   ✅ SUCCESS: Public API returned 0 rows. RLS is likely ACTIVE and preventing access.');
            } else {
                console.log('   ❌ WARNING: Public API returned data!');
                console.log(`      Found ${data.length} users exposed.`);
                console.log('      First exposed user ID:', data[0].id);
                console.log('   ⚠️  RLS MIGHT NOT BE ENABLED OR A POLICY IS TOO PERMISSIVE.');
            }
        } else {
            console.log('   ℹ️  API Response:', data);
        }

    } catch (error) {
        console.error('   ❌ Connection Error:', error.message);
    }
}

verifyRLS();
