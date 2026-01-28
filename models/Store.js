import mongoose from 'mongoose';

const storeSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    ownerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    address: String,
    phone: String,
    logoUrl: String,

    // Settings stored as flexible JSON
    settings: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },

    // Store status
    isOpen: {
        type: Boolean,
        default: false
    },
    lastOpenedAt: Date,
    lastClosedAt: Date,
    openedBy: String,
    closedBy: String
}, {
    timestamps: true
});

// Indexes
storeSchema.index({ ownerId: 1 });
storeSchema.index({ name: 1 });

const Store = mongoose.model('Store', storeSchema);

export default Store;
