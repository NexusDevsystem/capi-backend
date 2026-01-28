import mongoose from 'mongoose';

const invoiceSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    date: {
        type: Date,
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ['PAID', 'PENDING', 'EXPIRED'],
        required: true
    },
    method: {
        type: String,
        enum: ['PIX', 'CARD', 'MANUAL']
    },
    url: String
}, {
    timestamps: true
});

// Indexes
invoiceSchema.index({ userId: 1 });
invoiceSchema.index({ date: -1 });
invoiceSchema.index({ status: 1 });

const Invoice = mongoose.model('Invoice', invoiceSchema);

export default Invoice;
