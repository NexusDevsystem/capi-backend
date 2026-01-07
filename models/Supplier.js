import mongoose from 'mongoose';

const supplierSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
    name: { type: String, required: true },
    contactName: String,
    email: String,
    phone: String,
    category: String,
    notes: String
});

supplierSchema.set('toJSON', { virtuals: true, versionKey: false, transform: (doc, ret) => { ret.id = ret._id; delete ret._id; } });

export const Supplier = mongoose.model('Supplier', supplierSchema);
