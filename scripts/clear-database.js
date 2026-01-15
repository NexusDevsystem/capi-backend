
import prisma from '../prismaClient.js';

async function clearDatabase() {
    console.log('⚠️  STARTING DATABASE CLEARANCE...');

    try {
        // 1. Delete Junction Tables (StoreUser)
        console.log('Deleting StoreUsers...');
        await prisma.storeUser.deleteMany({});

        // 2. Delete Store Children
        console.log('Deleting Transactions...');
        await prisma.transaction.deleteMany({});
        console.log('Deleting Products...');
        await prisma.product.deleteMany({});
        console.log('Deleting Customers...');
        await prisma.customer.deleteMany({});
        console.log('Deleting Suppliers...');
        await prisma.supplier.deleteMany({});
        console.log('Deleting BankAccounts...');
        await prisma.bankAccount.deleteMany({});
        console.log('Deleting CashClosings...');
        await prisma.cashClosing.deleteMany({});
        console.log('Deleting ServiceOrders...');
        await prisma.serviceOrder.deleteMany({});

        // 3. Delete Stores
        console.log('Deleting Stores...');
        await prisma.store.deleteMany({});

        // 4. Delete User Children
        console.log('Deleting Invoices...');
        await prisma.invoice.deleteMany({});

        // 5. Delete Users
        console.log('Deleting Users...');
        await prisma.user.deleteMany({});

        console.log('✅ DATABASE CLEARED SUCCESSFULLY.');

    } catch (error) {
        console.error('❌ Error clearing database:', error);
        console.error('Details:', JSON.stringify(error, null, 2));
    } finally {
        await prisma.$disconnect();
    }
}

clearDatabase();
