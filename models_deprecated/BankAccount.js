import mongoose from 'mongoose';

const bankAccountSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
    name: String,
    type: String,
    balance: Number
});

bankAccountSchema.set('toJSON', { virtuals: true, versionKey: false, transform: (doc, ret) => { ret.id = ret._id; delete ret._id; } });

export const BankAccount = mongoose.model('BankAccount', bankAccountSchema);
