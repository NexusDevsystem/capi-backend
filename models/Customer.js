import mongoose from 'mongoose';
import { decrypt } from '../utils/encryption.js';

const customerSchema = new mongoose.Schema({
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

    // Encrypted phone
    phone: String,
    phoneHash: String,

    // Crediário (account balance)
    balance: {
        type: Number,
        default: 0
    },

    // Purchase/debt history
    items: [{
        id: String,
        date: Date,
        description: String,
        amount: Number
    }],

    lastUpdate: Date,

    // CRM Pipeline
    pipelineStage: {
        type: String,
        enum: ['LEAD', 'NEGOCIACAO', 'FECHADO', 'PERDIDO']
    }
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
customerSchema.index({ storeId: 1 });
customerSchema.index({ name: 'text' });
customerSchema.index({ phoneHash: 1 }, { sparse: true });
customerSchema.index({ pipelineStage: 1 }, { sparse: true });

const Customer = mongoose.model('Customer', customerSchema);

export default Customer;
