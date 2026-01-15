import mongoose from 'mongoose';

const storeUserSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    storeId: { type: String, required: true },
    role: {
        type: String,
        enum: ['Proprietário', 'owner', 'admin', 'manager', 'seller', 'technician'],
        required: true
    },
    permissions: [String],
    invitedBy: String,
    joinedAt: { type: Date, default: Date.now },
    status: {
        type: String,
        enum: ['active', 'inactive', 'pending'],
        default: 'active'
    }
});

// Compound index for efficient queries
storeUserSchema.index({ userId: 1, storeId: 1 }, { unique: true });
storeUserSchema.index({ storeId: 1 });

// Transform _id to id when converting to JSON
storeUserSchema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: function (doc, ret) {
        ret.id = ret._id;
        delete ret._id;
    }
});

export const StoreUser = mongoose.model('StoreUser', storeUserSchema);
