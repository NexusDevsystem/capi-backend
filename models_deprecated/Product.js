import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
    name: { type: String, required: true },
    sku: String,
    barcode: String,
    costPrice: Number,
    salePrice: Number,
    stock: Number,
    minStock: Number,
    expiryDate: Date,
    taxData: {
        taxOrigin: String,
        ncm: String,
        cest: String,
        cfop: String
    }
});

productSchema.set('toJSON', { virtuals: true, versionKey: false, transform: (doc, ret) => { ret.id = ret._id; delete ret._id; } });

export const Product = mongoose.model('Product', productSchema);
