import express from 'express';
import { Store } from '../models/Store.js';
import { StoreUser } from '../models/StoreUser.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Middleware to check if user is manager or owner of the store
const checkStoreAccess = async (req, res, next) => {
    try {
        const { storeId } = req.params;
        const userId = req.user.userId;

        // Check if user has access to this store
        const storeUser = await StoreUser.findOne({
            storeId,
            userId,
            role: { $in: ['owner', 'manager'] }
        });

        if (!storeUser) {
            return res.status(403).json({
                error: 'Apenas proprietários e gerentes podem abrir/fechar a loja'
            });
        }

        req.storeUser = storeUser;
        next();
    } catch (error) {
        console.error('Error checking store access:', error);
        res.status(500).json({ error: 'Erro ao verificar permissões' });
    }
};

// Open store
router.post('/:storeId/open', authMiddleware, checkStoreAccess, async (req, res) => {
    try {
        const { storeId } = req.params;
        const userId = req.user.userId;

        const store = await Store.findByIdAndUpdate(
            storeId,
            {
                isOpen: true,
                lastOpenedAt: new Date(),
                openedBy: userId
            },
            { new: true }
        );

        if (!store) {
            return res.status(404).json({ error: 'Loja não encontrada' });
        }

        res.json({
            message: 'Loja aberta com sucesso',
            store: {
                storeId: store._id,
                name: store.name,
                isOpen: store.isOpen,
                lastOpenedAt: store.lastOpenedAt,
                openedBy: store.openedBy
            }
        });
    } catch (error) {
        console.error('Error opening store:', error);
        res.status(500).json({ error: 'Erro ao abrir loja' });
    }
});

// Close store
router.post('/:storeId/close', authMiddleware, checkStoreAccess, async (req, res) => {
    try {
        const { storeId } = req.params;
        const userId = req.user.userId;

        const store = await Store.findByIdAndUpdate(
            storeId,
            {
                isOpen: false,
                lastClosedAt: new Date(),
                closedBy: userId
            },
            { new: true }
        );

        if (!store) {
            return res.status(404).json({ error: 'Loja não encontrada' });
        }

        res.json({
            message: 'Loja fechada com sucesso',
            store: {
                storeId: store._id,
                name: store.name,
                isOpen: store.isOpen,
                lastClosedAt: store.lastClosedAt,
                closedBy: store.closedBy
            }
        });
    } catch (error) {
        console.error('Error closing store:', error);
        res.status(500).json({ error: 'Erro ao fechar loja' });
    }
});

// Get store status
router.get('/:storeId/status', authMiddleware, async (req, res) => {
    try {
        const { storeId } = req.params;
        const userId = req.user.userId;

        // Check if user has access to this store
        const storeUser = await StoreUser.findOne({ storeId, userId });
        if (!storeUser) {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        const store = await Store.findById(storeId)
            .select('name isOpen lastOpenedAt lastClosedAt openedBy closedBy')
            .populate('openedBy', 'name')
            .populate('closedBy', 'name');

        if (!store) {
            return res.status(404).json({ error: 'Loja não encontrada' });
        }

        res.json({
            storeId: store._id,
            name: store.name,
            isOpen: store.isOpen,
            lastOpenedAt: store.lastOpenedAt,
            lastClosedAt: store.lastClosedAt,
            openedBy: store.openedBy,
            closedBy: store.closedBy
        });
    } catch (error) {
        console.error('Error getting store status:', error);
        res.status(500).json({ error: 'Erro ao buscar status da loja' });
    }
});

// Get all stores status (for owners)
router.get('/status/all', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;

        // Get all stores where user is owner or manager
        const storeUsers = await StoreUser.find({
            userId,
            role: { $in: ['owner', 'manager'] }
        }).select('storeId role');

        const storeIds = storeUsers.map(su => su.storeId);

        const stores = await Store.find({ _id: { $in: storeIds } })
            .select('name isOpen lastOpenedAt lastClosedAt openedBy closedBy')
            .populate('openedBy', 'name')
            .populate('closedBy', 'name');

        const storesWithRole = stores.map(store => {
            const storeUser = storeUsers.find(su => su.storeId.toString() === store._id.toString());
            return {
                storeId: store._id,
                name: store.name,
                isOpen: store.isOpen,
                lastOpenedAt: store.lastOpenedAt,
                lastClosedAt: store.lastClosedAt,
                openedBy: store.openedBy,
                closedBy: store.closedBy,
                userRole: storeUser?.role
            };
        });

        res.json({ stores: storesWithRole });
    } catch (error) {
        console.error('Error getting all stores status:', error);
        res.status(500).json({ error: 'Erro ao buscar status das lojas' });
    }
});

export default router;
