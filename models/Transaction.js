import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
    description: String,
    amount: Number,
    type: { type: String, enum: ['INCOME', 'EXPENSE'] },
    category: String,
    paymentMethod: String,
    date: Date,
    status: String,
    entity: String,
    items: [{
        productId: String,
        productName: String,
        quantity: Number,
        unitPrice: Number,
        total: Number
    }],
    bankAccountId: String
});

transactionSchema.set('toJSON', { virtuals: true, versionKey: false, transform: (doc, ret) => { ret.id = ret._id; delete ret._id; } });

export const Transaction = mongoose.model('Transaction', transactionSchema);
