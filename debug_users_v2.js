import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from './models/User.js';

dotenv.config();

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const users = await User.find({}, 'name email subscriptionStatus trialEndsAt memberSince');

        console.log("=== JSON DUMP START ===");
        console.log(JSON.stringify(users, null, 2));
        console.log("=== JSON DUMP END ===");

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
};

run();
