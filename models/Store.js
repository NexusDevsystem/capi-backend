
import mongoose from 'mongoose';

const storeSchema = new mongoose.Schema({
    name: { type: String, required: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    address: String,
    phone: String,
    logoUrl: { type: String },
    settings: {
        theme: String,
        notifications: Boolean
    },
    createdAt: { type: Date, default: Date.now }
});

export const Store = mongoose.model('Store', storeSchema);
