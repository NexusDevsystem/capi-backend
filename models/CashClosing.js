import mongoose from 'mongoose';

const cashClosingSchema = new mongoose.Schema({
    storeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Store',
        required: true
    },
    date: {
        type: Date,
        required: true
    },
    totalRevenue: {
        type: Number,
        required: true
    },
    totalExpense: {
        type: Number,
        required: true
    },
    balance: {
        type: Number,
        required: true
    },

    // Breakdown by payment method
    breakdown: {
        type: mongoose.Schema.Types.Mixed,
        default: {
            pix: 0,
            cash: 0,
            card: 0,
            other: 0
        }
    },

    notes: String,
    closedBy: String,
    closedAt: Date
}, {
    timestamps: true
});

// Indexes
cashClosingSchema.index({ storeId: 1 });
cashClosingSchema.index({ date: -1 });

const CashClosing = mongoose.model('CashClosing', cashClosingSchema);

export default CashClosing;
