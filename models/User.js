import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { encrypt, decrypt, hashField } from '../utils/encryption.js';

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },

    // Encrypted Fields (stored as IV:Cipher)
    phone: String,
    taxId: String,

    // Blind Indexes for Searching (Deterministic Hash)
    phoneHash: { type: String, index: true },
    taxIdHash: { type: String, index: true },

    role: {
        type: String,
        enum: ['Proprietário', 'Administrador', 'Gerente', 'Vendedor', 'Técnico', 'Aguardando', 'admin', 'user'],
        default: 'Aguardando'
    },
    // Multi-store support
    stores: [{
        storeId: { type: String, required: true },
        storeName: String,
        storeLogo: String,
        role: {
            type: String,
            enum: ['Proprietário', 'owner', 'admin', 'manager', 'seller', 'technician'],
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

// --- ENCRYPTION & HASHING MIDDLEWARE ---

userSchema.pre('save', async function (next) {
    // 1. Hash Password
    if (this.isModified('password')) {
        // Only hash if not already hashed (bcrypt hashes start with $2a$ or $2b$)
        if (!this.password.startsWith('$2')) {
            this.password = await bcrypt.hash(this.password, 10);
        }
    }

    // 2. Encrypt Phone
    if (this.isModified('phone') && this.phone) {
        if (!this.phone.includes(':')) { // Prevent double encryption
            this.phoneHash = hashField(this.phone); // Save searchable hash
            this.phone = encrypt(this.phone);       // Save encrypted data
        }
    }

    // 3. Encrypt TaxID
    if (this.isModified('taxId') && this.taxId) {
        if (!this.taxId.includes(':')) {
            this.taxIdHash = hashField(this.taxId); // Save searchable hash
            this.taxId = encrypt(this.taxId);       // Save encrypted data
        }
    }

    next();
});

// --- HELPER METHODS ---

userSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

// Transform _id to id when converting to JSON and DECRYPT fields
userSchema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: function (doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.password;
        delete ret.phoneHash;
        delete ret.taxIdHash;

        // Auto-decrypt for API responses
        if (ret.phone) ret.phone = decrypt(ret.phone);
        if (ret.taxId) ret.taxId = decrypt(ret.taxId);
    }
});

export const User = mongoose.model('User', userSchema);
