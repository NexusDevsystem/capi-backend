import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { encrypt, decrypt } from '../utils/encryption.js';

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    password: {
        type: String,
        required: true
    },
    // Encrypted fields
    phone: String,
    taxId: String,
    // Blind indexes for searching
    phoneHash: String,
    taxIdHash: String,

    role: {
        type: String,
        enum: ['Proprietário', 'Administrador', 'Gerente', 'Vendedor', 'Técnico', 'Aguardando'],
        default: 'Aguardando'
    },
    status: {
        type: String,
        enum: ['Ativo', 'Ausente', 'Pendente'],
        default: 'Pendente'
    },
    avatarUrl: String,
    googleId: {
        type: String,
        unique: true,
        sparse: true
    },

    // Subscription
    subscriptionStatus: {
        type: String,
        enum: ['FREE', 'TRIAL', 'ACTIVE', 'PENDING', 'CANCELED'],
        default: 'FREE'
    },
    trialEndsAt: Date,
    nextBillingAt: Date,
    memberSince: {
        type: Date,
        default: Date.now
    },
    lastAccess: {
        type: Date,
        default: Date.now
    },

    // Multi-store
    activeStoreId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Store'
    }
}, {
    timestamps: true,
    toJSON: {
        transform: function (doc, ret) {
            // Remove sensitive fields
            delete ret.password;
            delete ret.phoneHash;
            delete ret.taxIdHash;
            delete ret.__v;

            // Decrypt sensitive fields
            if (ret.phone) {
                try {
                    ret.phone = decrypt(ret.phone);
                } catch (e) {
                    ret.phone = null;
                }
            }
            if (ret.taxId) {
                try {
                    ret.taxId = decrypt(ret.taxId);
                } catch (e) {
                    ret.taxId = null;
                }
            }

            return ret;
        }
    }
});

// Indexes
userSchema.index({ email: 1 });
userSchema.index({ googleId: 1 }, { sparse: true });
userSchema.index({ phoneHash: 1 }, { sparse: true });
userSchema.index({ taxIdHash: 1 }, { sparse: true });

// Methods
userSchema.methods.comparePassword = async function (candidatePassword) {
    // Check if password is hashed (bcrypt format starts with $2)
    if (this.password.startsWith('$2')) {
        return await bcrypt.compare(candidatePassword, this.password);
    }
    // Legacy plain text comparison
    return this.password === candidatePassword;
};

// Virtual for stores (populated from StoreUser)
userSchema.virtual('stores', {
    ref: 'StoreUser',
    localField: '_id',
    foreignField: 'userId'
});

// Virtual for owned stores
userSchema.virtual('ownedStores', {
    ref: 'Store',
    localField: '_id',
    foreignField: 'ownerId'
});

const User = mongoose.model('User', userSchema);

export default User;
