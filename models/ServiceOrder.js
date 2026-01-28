import mongoose from 'mongoose';

const serviceOrderSchema = new mongoose.Schema({
    storeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Store',
        required: true
    },
    customerId: String,
    customerName: String,
    device: String,
    description: String,
    status: {
        type: String,
        enum: ['ABERTO', 'EM_ANALISE', 'AGUARDANDO_PECA', 'CONCLUIDO', 'ENTREGUE'],
        default: 'ABERTO'
    },

    // Pricing
    partsTotal: {
        type: Number,
        default: 0
    },
    laborTotal: {
        type: Number,
        default: 0
    },
    total: {
        type: Number,
        default: 0
    },

    openDate: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Indexes
serviceOrderSchema.index({ storeId: 1 });
serviceOrderSchema.index({ status: 1 });
serviceOrderSchema.index({ openDate: -1 });

const ServiceOrder = mongoose.model('ServiceOrder', serviceOrderSchema);

export default ServiceOrder;
