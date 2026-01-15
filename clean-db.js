import prisma from './prismaClient.js';

async function cleanDatabase() {
    try {
        console.log('🧹 Limpando banco de dados...');

        // Deletar na ordem correta para respeitar foreign keys
        await prisma.storeUser.deleteMany({});
        console.log('✅ StoreUsers deletados');

        await prisma.store.deleteMany({});
        console.log('✅ Stores deletadas');

        await prisma.user.deleteMany({});
        console.log('✅ Users deletados');

        console.log('✨ Banco de dados limpo com sucesso!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro ao limpar banco:', error);
        process.exit(1);
    }
}

cleanDatabase();
