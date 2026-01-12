import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from './models/User.js';

dotenv.config();

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const users = await User.find({}, 'name email subscriptionStatus trialEndsAt memberSince created_at');

        console.log("--- USERS REPORT ---");
        users.forEach(u => {
            console.log(`User: ${u.email}`);
            console.log(`  Status: ${u.subscriptionStatus}`);
            console.log(`  TrialEndsAt: ${u.trialEndsAt}`);
            console.log(`  MemberSince: ${u.memberSince}`);
            console.log("-----------------------");
        });

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
};

run();
