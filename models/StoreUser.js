import mongoose from 'mongoose';

const storeUserSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    storeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Store',
        required: true
    },
    role: {
        type: String,
        enum: ['owner', 'admin', 'manager', 'seller', 'technician'],
        required: true
    },
    permissions: {
        type: [String],
        default: []
    },
    status: {
        type: String,
        enum: ['active', 'Ativo', 'Pendente', 'inactive'],
        default: 'active'
    },

    // Financial
    salary: Number,
    commission: Number,

    // Metadata
    joinedAt: {
        type: Date,
        default: Date.now
    },
    invitedBy: String
}, {
    timestamps: true
});

// Compound unique index (user can only be in a store once)
storeUserSchema.index({ userId: 1, storeId: 1 }, { unique: true });
storeUserSchema.index({ storeId: 1 });
storeUserSchema.index({ userId: 1 });

const StoreUser = mongoose.model('StoreUser', storeUserSchema);

export default StoreUser;
