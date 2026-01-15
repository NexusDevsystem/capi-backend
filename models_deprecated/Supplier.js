import mongoose from 'mongoose';

import { encrypt, decrypt, hashField } from '../utils/encryption.js';

const supplierSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
    name: { type: String, required: true },
    contactName: String,
    email: String,
    phone: String,
    phoneHash: { type: String, index: true }, // Blind Index
    category: String,
    notes: String
});

// Encrypt Phone on Save
supplierSchema.pre('save', function (next) {
    if (this.isModified('phone') && this.phone) {
        if (!this.phone.includes(':')) {
            this.phoneHash = hashField(this.phone);
            this.phone = encrypt(this.phone);
        }
    }
    next();
});

supplierSchema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: (doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.phoneHash;
        if (ret.phone) ret.phone = decrypt(ret.phone);
    }
});

export const Supplier = mongoose.model('Supplier', supplierSchema);
