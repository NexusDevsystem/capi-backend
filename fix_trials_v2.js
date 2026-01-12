import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from './models/User.js';

dotenv.config();

const run = async () => {
    try {
        console.log("Iniciando Script de Correção Robusto...");

        if (!process.env.MONGODB_URI) {
            console.error("ERRO: Sem URI no .env");
            process.exit(1);
        }

        await mongoose.connect(process.env.MONGODB_URI);
        console.log(`Conectado ao DB: ${mongoose.connection.name}`);

        const users = await User.find({});
        console.log(`Encontrados ${users.length} usuários totais.`);

        // Filtra usuários relevantes
        const targets = users.filter(u =>
            u.subscriptionStatus === 'TRIAL' ||
            (u.trialEndsAt && new Date(u.trialEndsAt).getTime() > 0)
        );

        console.log(`Encontrados ${targets.length} alvos para correção de trial.`);

        let count = 0;
        for (const user of targets) {
            const startDate = user.memberSince || user.createdAt || (user._id && user._id.getTimestamp ? user._id.getTimestamp() : new Date());
            const start = new Date(startDate);

            // Calcula fim correto (2 dias após criar)
            const correctEnd = new Date(start);
            correctEnd.setDate(start.getDate() + 2);

            console.log(`[${user.email}] Ajustando Trial:`);
            console.log(`   Criado em: ${start.toLocaleString()}`);
            console.log(`   Fim Atual: ${user.trialEndsAt ? new Date(user.trialEndsAt).toLocaleString() : 'N/A'}`);
            console.log(`   Novo Fim : ${correctEnd.toLocaleString()}`);

            user.trialEndsAt = correctEnd;

            // Atualiza nextBillingAt também para refletir a expiração do trial na UI de faturamento
            if (user.subscriptionStatus === 'TRIAL') {
                user.nextBillingAt = correctEnd;
                console.log(`   nextBillingAt atualizado.`);
            }

            await user.save();
            count++;
        }

        console.log(`Sucesso! ${count} usuários corrigidos.`);
        process.exit(0);
    } catch (e) {
        console.error("Erro fatal:", e);
        process.exit(1);
    }
};

run();
