import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    phone: String,
    taxId: String,
    role: {
        type: String,
        enum: ['Administrador', 'Gerente', 'Vendedor', 'Técnico', 'Aguardando', 'admin', 'user'],
        default: 'Aguardando'
    },
    // Multi-store support
    stores: [{
        storeId: { type: String, required: true },
        storeName: String,
        storeLogo: String,
        role: {
            type: String,
            enum: ['owner', 'admin', 'manager', 'seller', 'technician'],
            required: true
        },
        joinedAt: { type: Date, default: Date.now },
        permissions: [String]
    }],
    activeStoreId: String, // Current active store context
    ownedStores: [String], // Stores created by this user
    // Legacy field for backward compatibility (will be migrated)
    storeId: { type: String },
    lastAccess: { type: Date, default: Date.now },
    status: {
        type: String,
        enum: ['Ativo', 'Ausente', 'Pendente'],
        default: 'Pendente'
    },
    avatarUrl: String,
    subscriptionStatus: {
        type: String,
        enum: ['ACTIVE', 'PENDING', 'CANCELED', 'FREE', 'TRIAL'],
        default: 'FREE'
    },
    trialEndsAt: Date,
    nextBillingAt: Date,
    memberSince: { type: Date, default: Date.now },
    invoices: [{
        id: String,
        date: Date,
        amount: Number,
        status: String,
        url: String,
        method: String
    }]
});

// Transform _id to id when converting to JSON
userSchema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: function (doc, ret) {
        ret.id = ret._id;
        delete ret._id;
    }
});

export const User = mongoose.model('User', userSchema);
