import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
    storeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Store',
        required: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    sku: String,
    barcode: String,

    // Pricing
    costPrice: {
        type: Number,
        default: 0
    },
    salePrice: {
        type: Number,
        default: 0
    },

    // Stock
    stock: {
        type: Number,
        default: 0
    },
    minStock: {
        type: Number,
        default: 0
    },

    expiryDate: Date,

    // Tax data (flexible JSON)
    taxData: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    }
}, {
    timestamps: true
});

// Indexes
productSchema.index({ storeId: 1 });
productSchema.index({ name: 'text' });
productSchema.index({ sku: 1 }, { sparse: true });
productSchema.index({ barcode: 1 }, { sparse: true });

const Product = mongoose.model('Product', productSchema);

export default Product;
