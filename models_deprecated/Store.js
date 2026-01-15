
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
    // Store Status Tracking
    isOpen: { type: Boolean, default: false },
    lastOpenedAt: { type: Date },
    lastClosedAt: { type: Date },
    openedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
});

export const Store = mongoose.model('Store', storeSchema);
