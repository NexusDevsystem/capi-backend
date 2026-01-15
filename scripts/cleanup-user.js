
import prisma from '../prismaClient.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

async function cleanup() {
    const targetEmail = 'test_1768414724769@capi.com';
    // ID from screenshot: ef485c99-4a47-4aff-aaf7-aac72051fc5a

    try {
        console.log(`Searching for user: ${targetEmail}...`);
        const user = await prisma.user.findFirst({
            where: {
                OR: [
                    { email: targetEmail },
                    { id: 'ef485c99-4a47-4aff-aaf7-aac72051fc5a' }
                ]
            },
            include: {
                ownedStores: true
            }
        });

        if (!user) {
            console.log('User not found.');
            return;
        }

        console.log(`Found user: ${user.name} (${user.id})`);

        // 1. Delete owned stores (and their contents)
        for (const store of user.ownedStores) {
            console.log(`Processing owned store: ${store.name} (${store.id})`);

            // Delete dependent data for this store
            console.log('  - Deleting products...');
            await prisma.product.deleteMany({ where: { storeId: store.id } });

            console.log('  - Deleting transactions...');
            await prisma.transaction.deleteMany({ where: { storeId: store.id } });

            console.log('  - Deleting store users (team)...');
            await prisma.storeUser.deleteMany({ where: { storeId: store.id } });

            // Finally delete the store
            console.log('  - Deleting store...');
            await prisma.store.delete({ where: { id: store.id } });
        }

        // 2. Delete any remaining StoreUser memberships for this user
        console.log('Deleting remaining memberships...');
        await prisma.storeUser.deleteMany({ where: { userId: user.id } });

        // 3. Delete the user
        console.log('Deleting user...');
        await prisma.user.delete({ where: { id: user.id } });

        console.log('✅ CLEANUP COMPLETE. User deleted.');

    } catch (error) {
        console.error('❌ Error during cleanup:', error);
    } finally {
        await prisma.$disconnect();
    }
}

cleanup();
