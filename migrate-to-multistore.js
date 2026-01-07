import mongoose from 'mongoose';
import { User } from './models/User.js';

/**
 * Migration script to convert single-store users to multi-store architecture
 * Run this once after deploying the new User model
 */

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://Nexus:Nexusdevsystem132@nexusteam.mayhjak.mongodb.net/CAPI';

async function migrateToMultiStore() {
    try {
        console.log('🔄 Starting migration to multi-store architecture...');

        await mongoose.connect(MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        // Find all users with old storeId field
        const usersToMigrate = await User.find({
            storeId: { $exists: true, $ne: null },
            stores: { $exists: false }
        });

        console.log(`📊 Found ${usersToMigrate.length} users to migrate`);

        let migratedCount = 0;
        let errorCount = 0;

        for (const user of usersToMigrate) {
            try {
                // Determine role based on current role
                let storeRole = 'seller';
                if (user.role === 'Administrador' || user.role === 'admin') {
                    storeRole = 'owner';
                } else if (user.role === 'Gerente') {
                    storeRole = 'manager';
                } else if (user.role === 'Vendedor') {
                    storeRole = 'seller';
                } else if (user.role === 'Técnico') {
                    storeRole = 'technician';
                }

                // Create stores array with single entry
                const storeEntry = {
                    storeId: user.storeId,
                    storeName: user.storeName || 'Minha Loja',
                    storeLogo: user.storeLogo,
                    role: storeRole,
                    joinedAt: user.memberSince || new Date(),
                    permissions: []
                };

                // Update user
                await User.updateOne(
                    { _id: user._id },
                    {
                        $set: {
                            stores: [storeEntry],
                            activeStoreId: user.storeId,
                            ownedStores: storeRole === 'owner' ? [user.storeId] : []
                        }
                    }
                );

                migratedCount++;
                console.log(`✅ Migrated user: ${user.email} (${storeRole})`);
            } catch (error) {
                errorCount++;
                console.error(`❌ Error migrating user ${user.email}:`, error.message);
            }
        }

        console.log('\n📈 Migration Summary:');
        console.log(`   ✅ Successfully migrated: ${migratedCount}`);
        console.log(`   ❌ Errors: ${errorCount}`);
        console.log(`   📊 Total processed: ${usersToMigrate.length}`);

        await mongoose.disconnect();
        console.log('\n✅ Migration completed and database disconnected');

    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

// Run migration
migrateToMultiStore();
