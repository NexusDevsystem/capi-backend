import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
    storeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Store',
        required: true
    },
    description: String,
    amount: {
        type: Number,
        required: true
    },
    type: {
        type: String,
        enum: ['INCOME', 'EXPENSE'],
        required: true
    },
    category: String,
    paymentMethod: {
        type: String,
        enum: ['Pix', 'Dinheiro', 'Crédito', 'Débito', 'Boleto', 'Outro']
    },
    status: {
        type: String,
        enum: ['PENDING', 'COMPLETED', 'PAID', 'OVERDUE', 'SCHEDULED'],
        default: 'COMPLETED'
    },
    date: {
        type: Date,
        required: true,
        default: Date.now
    },
    entity: String, // Customer/Supplier name

    // Items sold (for sales transactions)
    items: [{
        productId: String,
        productName: String,
        quantity: Number,
        unitPrice: Number,
        total: Number
    }],

    bankAccountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'BankAccount'
    },

    // Flags
    isDebtPayment: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

// Indexes
transactionSchema.index({ storeId: 1 });
transactionSchema.index({ date: -1 });
transactionSchema.index({ type: 1 });
transactionSchema.index({ status: 1 });

const Transaction = mongoose.model('Transaction', transactionSchema);

export default Transaction;
