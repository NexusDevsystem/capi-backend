import mongoose from 'mongoose';

const customerSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
    name: { type: String, required: true },
    phone: String,
    balance: { type: Number, default: 0 },
    items: [{
        date: Date,
        description: String,
        amount: Number
    }],
    lastUpdate: Date,
    pipelineStage: String
});

customerSchema.set('toJSON', { virtuals: true, versionKey: false, transform: (doc, ret) => { ret.id = ret._id; delete ret._id; } });

export const Customer = mongoose.model('Customer', customerSchema);
