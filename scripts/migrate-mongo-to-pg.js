import mongoose from 'mongoose';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
import dotenv from 'dotenv';
import fs from 'fs';
import util from 'util';

// Import Mongoose Models
import { User } from '../models/User.js';
import { Store } from '../models/Store.js';
import { StoreUser } from '../models/StoreUser.js';
import { Product } from '../models/Product.js';
import { Transaction } from '../models/Transaction.js';
import { Customer } from '../models/Customer.js';
import { Supplier } from '../models/Supplier.js';
import { BankAccount } from '../models/BankAccount.js';
import { CashClosing } from '../models/CashClosing.js';
import { ServiceOrder } from '../models/ServiceOrder.js';

const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

dotenv.config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const connectMongo = async () => {
    if (!process.env.MONGODB_URI) {
        throw new Error("MONGODB_URI not found in .env");
    }
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("🍃 Connected to MongoDB");
};

const migrateUsers = async () => {
    console.log("Migrating Users...");
    const users = await User.find();

    for (const u of users) {
        const id = u._id.toString();

        await prisma.user.upsert({
            where: { id },
            update: {},
            create: {
                id,
                name: u.name,
                email: u.email,
                password: u.password,
                phone: u.phone,
                taxId: u.taxId,
                phoneHash: u.phoneHash,
                taxIdHash: u.taxIdHash,
                role: u.role || 'Aguardando',
                status: u.status || 'Pendente',
                avatarUrl: u.avatarUrl,
                subscriptionStatus: u.subscriptionStatus || 'FREE',
                trialEndsAt: u.trialEndsAt,
                nextBillingAt: u.nextBillingAt,
                memberSince: u.memberSince || new Date(),
                activeStoreId: u.activeStoreId,
                lastAccess: u.lastAccess || new Date()
            }
        });

        if (u.invoices && u.invoices.length > 0) {
            for (const inv of u.invoices) {
                const invId = inv.id || `MIG-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                const existing = await prisma.invoice.findUnique({ where: { id: invId } });
                if (!existing) {
                    await prisma.invoice.create({
                        data: {
                            id: invId,
                            userId: id,
                            date: inv.date || new Date(),
                            amount: inv.amount || 0,
                            status: inv.status || 'PENDING',
                            method: inv.method,
                            url: inv.url
                        }
                    });
                }
            }
        }
    }
    console.log(`✅ Migrated ${users.length} Users.`);
};

const migrateStores = async () => {
    console.log("Migrating Stores...");
    const stores = await Store.find();

    for (const s of stores) {
        const id = s._id.toString();
        const ownerId = s.owner.toString();

        const ownerExists = await prisma.user.findUnique({ where: { id: ownerId } });
        if (!ownerExists) {
            console.warn(`⚠️ Store ${s.name} (${id}) skipped because owner ${ownerId} missing.`);
            continue;
        }

        await prisma.store.upsert({
            where: { id },
            update: {},
            create: {
                id,
                name: s.name,
                ownerId,
                address: s.address,
                phone: s.phone,
                logoUrl: s.logoUrl,
                settings: s.settings || {},
                isOpen: s.isOpen || false,
                lastOpenedAt: s.lastOpenedAt,
                lastClosedAt: s.lastClosedAt,
                openedBy: s.openedBy?.toString(),
                closedBy: s.closedBy?.toString(),
                createdAt: s.createdAt || new Date()
            }
        });
    }
    console.log(`✅ Migrated ${stores.length} Stores.`);
};

const migrateStoreUsers = async () => {
    console.log("Migrating StoreUsers (Team)...");
    const storeUsers = await StoreUser.find();

    for (const su of storeUsers) {
        const userId = su.userId;
        const storeId = su.storeId;

        const userExists = await prisma.user.findUnique({ where: { id: userId } });
        const storeExists = await prisma.store.findUnique({ where: { id: storeId } });

        if (!userExists || !storeExists) {
            continue;
        }

        const existing = await prisma.storeUser.findUnique({
            where: { userId_storeId: { userId, storeId } }
        });

        if (!existing) {
            await prisma.storeUser.create({
                data: {
                    userId,
                    storeId,
                    role: su.role,
                    permissions: su.permissions || [],
                    joinedAt: su.joinedAt || new Date(),
                    status: su.status || 'active',
                    invitedBy: su.invitedBy
                }
            });
        }
    }
    console.log(`✅ Migrated ${storeUsers.length} StoreUsers.`);
};

const migrateProducts = async () => {
    console.log("Migrating Products...");
    const items = await Product.find();
    for (const item of items) {
        const id = item._id.toString();
        if (!item.storeId) continue;
        const storeId = item.storeId.toString();

        const storeExists = await prisma.store.findUnique({ where: { id: storeId } });
        if (!storeExists) continue;

        await prisma.product.upsert({
            where: { id },
            update: {},
            create: {
                id,
                storeId,
                name: item.name,
                sku: item.sku,
                barcode: item.barcode,
                costPrice: item.costPrice,
                salePrice: item.salePrice,
                stock: item.stock,
                minStock: item.minStock,
                expiryDate: item.expiryDate,
                taxData: item.taxData || {}
            }
        });
    }
    console.log(`✅ Migrated ${items.length} Products.`);
};

const migrateTransactions = async () => {
    console.log("Migrating Transactions...");
    const items = await Transaction.find();
    for (const item of items) {
        const id = item._id.toString();
        if (!item.storeId) continue;
        const storeId = item.storeId.toString();

        const storeExists = await prisma.store.findUnique({ where: { id: storeId } });
        if (!storeExists) continue;

        await prisma.transaction.upsert({
            where: { id },
            update: {},
            create: {
                id,
                storeId: storeId,
                description: item.description,
                amount: item.amount || 0,
                type: item.type || 'EXPENSE',
                category: item.category,
                paymentMethod: item.paymentMethod,
                status: item.status,
                date: item.date || new Date(),
                entity: item.entity,
                items: item.items || [], // Json
                bankAccountId: item.bankAccountId
            }
        });
    }
    console.log(`✅ Migrated ${items.length} Transactions.`);
};

const migrateCustomers = async () => {
    console.log("Migrating Customers...");
    const items = await Customer.find();
    for (const item of items) {
        const id = item._id.toString();
        if (!item.storeId) continue;
        const storeId = item.storeId.toString();

        const storeExists = await prisma.store.findUnique({ where: { id: storeId } });
        if (!storeExists) continue;

        await prisma.customer.upsert({
            where: { id },
            update: {},
            create: {
                id,
                storeId,
                name: item.name,
                phone: item.phone,
                phoneHash: item.phoneHash,
                balance: item.balance || 0,
                items: item.items || [],
                lastUpdate: item.lastUpdate,
                pipelineStage: item.pipelineStage
            }
        });
    }
    console.log(`✅ Migrated ${items.length} Customers.`);
};

const migrateSuppliers = async () => {
    console.log("Migrating Suppliers...");
    const items = await Supplier.find();
    for (const item of items) {
        const id = item._id.toString();
        if (!item.storeId) continue;
        const storeId = item.storeId.toString();

        const storeExists = await prisma.store.findUnique({ where: { id: storeId } });
        if (!storeExists) continue;

        await prisma.supplier.upsert({
            where: { id },
            update: {},
            create: {
                id,
                storeId,
                name: item.name,
                contactName: item.contactName,
                email: item.email,
                phone: item.phone,
                phoneHash: item.phoneHash,
                category: item.category,
                notes: item.notes
            }
        });
    }
    console.log(`✅ Migrated ${items.length} Suppliers.`);
};

const migrateBankAccounts = async () => {
    console.log("Migrating BankAccounts...");
    const items = await BankAccount.find();
    for (const item of items) {
        const id = item._id.toString();
        if (!item.storeId) continue;
        const storeId = item.storeId.toString();

        const storeExists = await prisma.store.findUnique({ where: { id: storeId } });
        if (!storeExists) continue;

        await prisma.bankAccount.upsert({
            where: { id },
            update: {},
            create: {
                id,
                storeId,
                name: item.name,
                type: item.type,
                balance: item.balance || 0
            }
        });
    }
    console.log(`✅ Migrated ${items.length} BankAccounts.`);
};

const migrateCashClosings = async () => {
    console.log("Migrating CashClosings...");
    const items = await CashClosing.find();
    for (const item of items) {
        const id = item._id.toString();
        if (!item.storeId) continue;
        const storeId = item.storeId.toString();

        const storeExists = await prisma.store.findUnique({ where: { id: storeId } });
        if (!storeExists) continue;

        await prisma.cashClosing.upsert({
            where: { id },
            update: {},
            create: {
                id,
                storeId,
                date: item.date || new Date(),
                totalRevenue: item.totalRevenue || 0,
                totalExpense: item.totalExpense || 0,
                balance: item.balance || 0,
                breakdown: item.breakdown || {},
                notes: item.notes,
                closedBy: item.closedBy,
                closedAt: item.closedAt
            }
        });
    }
    console.log(`✅ Migrated ${items.length} CashClosings.`);
};

const migrateServiceOrders = async () => {
    console.log("Migrating ServiceOrders...");
    const items = await ServiceOrder.find();
    for (const item of items) {
        const id = item._id.toString();
        if (!item.storeId) continue;
        const storeId = item.storeId.toString();

        const storeExists = await prisma.store.findUnique({ where: { id: storeId } });
        if (!storeExists) continue;

        await prisma.serviceOrder.upsert({
            where: { id },
            update: {},
            create: {
                id,
                storeId,
                customerId: item.customerId,
                customerName: item.customerName,
                device: item.device,
                description: item.description,
                status: item.status,
                partsTotal: item.partsTotal || 0,
                laborTotal: item.laborTotal || 0,
                total: item.total || 0,
                openDate: item.openDate
            }
        });
    }
    console.log(`✅ Migrated ${items.length} ServiceOrders.`);
};


const run = async () => {
    try {
        await connectMongo();

        await migrateUsers();
        await migrateStores();
        await migrateStoreUsers();

        await migrateProducts();
        await migrateTransactions();
        await migrateCustomers();
        await migrateSuppliers();
        await migrateBankAccounts();
        await migrateCashClosings();
        await migrateServiceOrders();

        console.log("🎉 Migration Completed Successfully!");
        process.exit(0);
    } catch (e) {
        console.error("❌ Migration Failed:", e);
        try {
            fs.writeFileSync('migration_panic.log', util.inspect(e) + '\n' + e.stack);
        } catch (err) {
            console.error("Failed to write log:", err);
        }
        process.exit(1);
    } finally {
        await prisma.$disconnect();
        await mongoose.disconnect();
    }
};

run();
