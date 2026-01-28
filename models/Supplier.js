import mongoose from 'mongoose';
import { decrypt } from '../utils/encryption.js';

const supplierSchema = new mongoose.Schema({
    storeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Store',
        required: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    contactName: String,
    email: String,

    // Encrypted phone
    phone: String,
    phoneHash: String,

    category: String,
    notes: String
}, {
    timestamps: true,
    toJSON: {
        transform: function (doc, ret) {
            delete ret.phoneHash;
            delete ret.__v;

            // Decrypt phone
            if (ret.phone) {
                try {
                    ret.phone = decrypt(ret.phone);
                } catch (e) {
                    ret.phone = null;
                }
            }

            return ret;
        }
    }
});

// Indexes
supplierSchema.index({ storeId: 1 });
supplierSchema.index({ name: 'text' });
supplierSchema.index({ phoneHash: 1 }, { sparse: true });

const Supplier = mongoose.model('Supplier', supplierSchema);

export default Supplier;
