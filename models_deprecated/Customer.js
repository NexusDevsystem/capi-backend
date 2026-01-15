import mongoose from 'mongoose';

import { encrypt, decrypt, hashField } from '../utils/encryption.js';

const customerSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
    name: { type: String, required: true },
    phone: String,
    phoneHash: { type: String, index: true }, // Blind Index
    balance: { type: Number, default: 0 },
    items: [{
        date: Date,
        description: String,
        amount: Number
    }],
    lastUpdate: Date,
    pipelineStage: String
});

// Encrypt Phone on Save
customerSchema.pre('save', function (next) {
    if (this.isModified('phone') && this.phone) {
        if (!this.phone.includes(':')) {
            this.phoneHash = hashField(this.phone);
            this.phone = encrypt(this.phone);
        }
    }
    next();
});

customerSchema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: (doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.phoneHash;
        if (ret.phone) ret.phone = decrypt(ret.phone);
    }
});

export const Customer = mongoose.model('Customer', customerSchema);
