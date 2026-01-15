import mongoose from 'mongoose';

const serviceOrderSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
    customerId: String,
    customerName: String,
    device: String,
    description: String,
    status: String,
    partsTotal: Number,
    laborTotal: Number,
    total: Number,
    openDate: Date
});

serviceOrderSchema.set('toJSON', { virtuals: true, versionKey: false, transform: (doc, ret) => { ret.id = ret._id; delete ret._id; } });

export const ServiceOrder = mongoose.model('ServiceOrder', serviceOrderSchema);
