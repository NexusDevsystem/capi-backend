import mongoose from 'mongoose';

const bankAccountSchema = new mongoose.Schema({
    storeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Store',
        required: true
    },
    name: String,
    type: String,
    balance: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

// Indexes
bankAccountSchema.index({ storeId: 1 });

const BankAccount = mongoose.model('BankAccount', bankAccountSchema);

export default BankAccount;
