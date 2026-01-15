
import prisma from './prismaClient.js';

async function main() {
    const email = 'jaoomarcos75@gmail.com';
    console.log(`Checking for user: ${email}...`);

    const user = await prisma.user.findUnique({
        where: { email }
    });

    if (user) {
        console.log('User found:', user);
        console.log('Deleting user to reset flow...');

        // Delete related StoreUser records first if any (cascade usually handles this but safety first)
        await prisma.storeUser.deleteMany({ where: { userId: user.id } });

        // Delete the user
        await prisma.user.delete({ where: { id: user.id } });
        console.log('User deleted successfully.');
    } else {
        console.log('User not found. They should be treated as a new user.');
    }
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
