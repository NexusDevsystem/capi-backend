import mongoose from 'mongoose';

const cashClosingSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
    date: Date,
    totalRevenue: Number,
    totalExpense: Number,
    balance: Number,
    breakdown: {
        pix: Number,
        cash: Number,
        card: Number,
        other: Number
    },
    notes: String,
    closedBy: String,
    closedAt: Date
});

cashClosingSchema.set('toJSON', { virtuals: true, versionKey: false, transform: (doc, ret) => { ret.id = ret._id; delete ret._id; } });

export const CashClosing = mongoose.model('CashClosing', cashClosingSchema);
