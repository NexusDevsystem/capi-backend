import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from './models/User.js';
import { Store } from './models/Store.js';
import { Product } from './models/Product.js';
import { Transaction } from './models/Transaction.js';
import { Customer } from './models/Customer.js';
import { ServiceOrder } from './models/ServiceOrder.js';
import { Supplier } from './models/Supplier.js';
import { CashClosing } from './models/CashClosing.js';
import { BankAccount } from './models/BankAccount.js';
import { StoreUser } from './models/StoreUser.js';
import { authMiddleware, generateToken } from './middleware/auth.js';

dotenv.config();

// Check for Fetch API (Node 18+ has it built-in)
if (!globalThis.fetch) {
    console.warn("⚠️  Aviso: Sua versão do Node.js é antiga. Para o backend funcionar corretamente, use Node 18+.");
}

const app = express();
const port = 3001;

// --- CONFIGURAÇÃO CAKTO (NEW PAYMENT GATEWAY) ---
const CAKTO_CLIENT_ID = process.env.CAKTO_CLIENT_ID;
const CAKTO_CLIENT_SECRET = process.env.CAKTO_CLIENT_SECRET;
const CAKTO_CHECKOUT_URL = process.env.CAKTO_CHECKOUT_URL;
const CAKTO_BASE_URL = "https://api.cakto.com.br";

// Cache do token CAKTO (evita requisições desnecessárias)
let caktoTokenCache = { token: null, expiresAt: 0 };

/**
 * Obtém token de acesso CAKTO via OAuth2
 */
async function getCaktoAccessToken() {
    // Verifica se token em cache ainda é válido
    if (caktoTokenCache.token && Date.now() < caktoTokenCache.expiresAt) {
        return caktoTokenCache.token;
    }

    try {
        const response = await fetch(`${CAKTO_BASE_URL}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: CAKTO_CLIENT_ID,
                client_secret: CAKTO_CLIENT_SECRET,
                grant_type: 'client_credentials'
            })
        });

        if (!response.ok) {
            throw new Error(`CAKTO OAuth failed: ${response.status}`);
        }

        const data = await response.json();

        // Armazena token em cache (expira em 1 hora - 5 minutos de margem)
        caktoTokenCache = {
            token: data.access_token,
            expiresAt: Date.now() + (55 * 60 * 1000)
        };

        return data.access_token;
    } catch (error) {
        console.error('Erro ao obter token CAKTO:', error);
        throw error;
    }
}

// --- CONFIGURAÇÃO MONGODB ---
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.warn("⚠️  Aviso: MONGODB_URI não definida no arquivo .env.local. O banco de dados não será conectado.");
} else {
    mongoose.connect(MONGODB_URI)
        .then(() => console.log("🍃 MongoDB Conectado com Sucesso!"))
        .catch(err => console.error("❌ Erro ao conectar no MongoDB:", err));
}

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// --- ENDPOINTS USUÁRIOS & LOJAS (MONGODB) ---

// Criar Usuário
app.post('/api/users', async (req, res) => {
    try {
        const { name, email, password, phone, taxId, role, storeId, avatarUrl, status } = req.body;

        // Verificar se usuário já existe
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ status: 'error', message: 'Usuário já cadastrado.' });
        }

        // --- LÓGICA DE TRIAL DE 7 DIAS ---
        const now = new Date();
        const trialEnd = new Date();
        trialEnd.setDate(now.getDate() + 7); // +7 dias

        const newUser = new User({
            name,
            email,
            password,
            phone,
            taxId,
            role: role || 'user',
            storeId,
            avatarUrl,
            status: status || 'Pendente',
            subscriptionStatus: 'TRIAL',
            trialEndsAt: trialEnd,
            memberSince: now
        });
        await newUser.save();

        const userResponse = newUser.toObject();
        delete userResponse.password;

        res.status(201).json({ status: 'success', data: userResponse });
    } catch (error) {
        console.error('Erro ao criar usuário:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao criar usuário.' });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email, password }); // In production, use bcrypt.compare

        if (!user) {
            return res.status(401).json({ status: 'error', message: 'Email ou senha incorretos.' });
        }

        // --- VERIFICAR EXPIRAÇÃO DO TRIAL ---
        if (user.subscriptionStatus === 'TRIAL' && user.trialEndsAt) {
            const now = new Date();
            if (now > user.trialEndsAt) {
                user.subscriptionStatus = 'PENDING'; // Expirou, precisa pagar
                await user.save();
            }
        }

        const userResponse = user.toObject();
        delete userResponse.password;

        const token = generateToken(user);

        res.json({ status: 'success', data: { ...userResponse, token } });
    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).json({ status: 'error', message: 'Erro interno no login.' });
    }
});

// Atualizar Usuário (Genérico) - PROTECTED
app.put('/api/users/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        // AUTH CHECK: Ensure user is updating themselves or is admin
        if (req.user.id !== id && req.user.role !== 'admin') {
            return res.status(403).json({ status: 'error', message: 'Sem permissão para alterar este usuário.' });
        }

        // SECURITY: Block direct updates to sensitive fields
        const blockedFields = ['subscriptionStatus', 'trialEndsAt', 'nextBillingAt', 'invoices'];
        const hasBlockedField = blockedFields.some(field => field in updates);

        if (hasBlockedField) {
            return res.status(403).json({
                status: 'error',
                message: 'Não é permitido atualizar campos de assinatura diretamente. Use o endpoint apropriado.'
            });
        }

        const user = await User.findByIdAndUpdate(id, updates, { new: true });
        res.json({ status: 'success', data: user });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Erro ao atualizar usuário.' });
    }
});

// Switch Active Store - PROTECTED
app.put('/api/users/:userId/active-store', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        const { storeId } = req.body;

        if (req.user.id !== userId) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized action' });
        }

        if (!storeId) {
            return res.status(400).json({ status: 'error', message: 'Store ID required' });
        }

        // Verify if user is member of this store
        const membership = await StoreUser.findOne({ userId, storeId });
        if (!membership) {
            return res.status(403).json({ status: 'error', message: 'User is not a member of this store' });
        }

        // Update active store
        const user = await User.findByIdAndUpdate(userId, { storeId }, { new: true });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        // Return updated user data formatted for frontend session
        res.json({
            status: 'success',
            data: user,
            message: 'Active store updated'
        });
    } catch (error) {
        console.error('Error switching active store:', error);
        res.status(500).json({ status: 'error', message: 'Failed to switch active store' });
    }
});

// Contratar Funcionário
app.post('/api/users/hire', async (req, res) => {
    try {
        const { email, storeId, role } = req.body;
        const user = await User.findOneAndUpdate(
            { email },
            { storeId, role, status: 'Ativo' },
            { new: true }
        );

        if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' });
        res.json({ status: 'success', data: user });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Erro ao contratar funcionário.' });
    }
});

// Listar Time da Loja
app.get('/api/stores/:storeId/team', async (req, res) => {
    try {
        const { storeId } = req.params;
        const team = await User.find({ storeId });
        res.json({ status: 'success', data: team });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Erro ao buscar time.' });
    }
});

// --- STORE STATUS MANAGEMENT ---

// Open Store (Manager/Owner only) - PROTECTED
app.post('/api/stores/:storeId/open', authMiddleware, async (req, res) => {
    console.log(`[API] OPEN request for store ${req.params.storeId} by user ${req.user.id}`);
    try {
        const { storeId } = req.params;
        const userId = req.user.id; // From Safe Token

        // Check if user has permission (owner or manager)
        const storeUser = await StoreUser.findOne({
            storeId,
            userId,
            role: { $in: ['owner', 'manager'] }
        });

        console.log(`[API] Permission check for ${userId} on ${storeId}:`, storeUser ? 'GRANTED' : 'DENIED');

        if (!storeUser) {
            console.log('[API] Permission Denied');
            console.log('DEBUG DETAILS:', { storeId, userId, body: req.body });
            return res.status(403).json({
                status: 'error',
                message: `ERRO PERMISSÃO: userId='${userId}', storeId='${storeId}'. Verifique console do servidor.`
            });
        }

        const store = await Store.findByIdAndUpdate(
            storeId,
            {
                isOpen: true,
                lastOpenedAt: new Date(),
                openedBy: userId
            },
            { new: true }
        );

        console.log(`[API] Store updated:`, store ? `${store.name} isOpen=${store.isOpen}` : 'Not Found');

        if (!store) {
            return res.status(404).json({ status: 'error', message: 'Loja não encontrada' });
        }

        res.json({
            status: 'success',
            message: 'Loja aberta com sucesso',
            data: {
                storeId: store._id,
                name: store.name,
                isOpen: store.isOpen,
                lastOpenedAt: store.lastOpenedAt
            }
        });
    } catch (error) {
        console.error('Error opening store:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao abrir loja' });
    }
});

// Close Store (Manager/Owner only) - PROTECTED
app.post('/api/stores/:storeId/close', authMiddleware, async (req, res) => {
    try {
        const { storeId } = req.params;
        const userId = req.user.id; // From Safe Token

        // Check if user has permission (owner or manager)
        const storeUser = await StoreUser.findOne({
            storeId,
            userId,
            role: { $in: ['owner', 'manager'] }
        });

        if (!storeUser) {
            return res.status(403).json({
                status: 'error',
                message: 'Apenas proprietários e gerentes podem fechar a loja'
            });
        }

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
            return res.status(404).json({ status: 'error', message: 'Loja não encontrada' });
        }

        res.json({
            status: 'success',
            message: 'Loja fechada com sucesso',
            data: {
                storeId: store._id,
                name: store.name,
                isOpen: store.isOpen,
                lastClosedAt: store.lastClosedAt
            }
        });
    } catch (error) {
        console.error('Error closing store:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao fechar loja' });
    }
});

// Get Store Status
app.get('/api/stores/:storeId/status', async (req, res) => {
    try {
        const { storeId } = req.params;

        const store = await Store.findById(storeId)
            .select('name isOpen lastOpenedAt lastClosedAt openedBy closedBy')
            .populate('openedBy', 'name')
            .populate('closedBy', 'name');

        if (!store) {
            return res.status(404).json({ status: 'error', message: 'Loja não encontrada' });
        }

        res.json({
            status: 'success',
            data: {
                storeId: store._id,
                name: store.name,
                isOpen: store.isOpen,
                lastOpenedAt: store.lastOpenedAt,
                lastClosedAt: store.lastClosedAt,
                openedBy: store.openedBy,
                closedBy: store.closedBy
            }
        });
    } catch (error) {
        console.error('Error getting store status:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao buscar status da loja' });
    }
});

// Get All Stores Status (for user's stores)
app.get('/api/stores/status/all', async (req, res) => {
    try {
        const { userId } = req.query; // In production, get from auth middleware

        // Get all stores where user is owner or manager
        const storeUsers = await StoreUser.find({
            userId,
            role: { $in: ['owner', 'manager'] }
        }).select('storeId role');

        const storeIds = storeUsers.map(su => su.storeId);

        const stores = await Store.find({ _id: { $in: storeIds } })
            .select('name isOpen lastOpenedAt lastClosedAt')
            .lean();

        const storesWithRole = stores.map(store => {
            const storeUser = storeUsers.find(su => su.storeId.toString() === store._id.toString());
            return {
                ...store,
                userRole: storeUser?.role
            };
        });

        res.json({ status: 'success', data: storesWithRole });
    } catch (error) {
        console.error('Error getting all stores status:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao buscar status das lojas' });
    }
});

// DEBUG: Dump all stores status and StoreUser relations
app.get('/api/debug/stores-dump', async (req, res) => {
    try {
        const stores = await Store.find({}).select('name isOpen _id lastOpenedAt');
        const storeUsers = await StoreUser.find({});
        res.json({ stores, storeUsers });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- END STORE STATUS MANAGEMENT ---

// Get User Stores with Status - PROTECTED
app.get('/api/users/:userId/stores', authMiddleware, async (req, res) => {
    console.log(`[API] Fetching stores for user ${req.params.userId}`);
    try {
        const { userId } = req.params;

        if (req.user.id !== userId) return res.status(403).send('Unauthorized');

        // Find all stores where user is a member
        const storeUsers = await StoreUser.find({ userId }).select('storeId role joinedAt permissions');

        if (!storeUsers || storeUsers.length === 0) {
            console.log('[API] No stores found for user');
            return res.json({
                status: 'success',
                data: {
                    stores: [],
                    activeStoreId: null,
                    ownedStores: []
                }
            });
        }

        // Get store details with status
        const storeIds = storeUsers.map(su => su.storeId);
        const stores = await Store.find({ _id: { $in: storeIds } })
            .select('name logoUrl isOpen lastOpenedAt lastClosedAt')
            .lean();

        console.log('[API] Found stores from DB:', stores.map(s => `${s.name} (isOpen: ${s.isOpen})`));

        // Combine store data with user role
        const userStores = stores.map(store => {
            const storeUser = storeUsers.find(su => su.storeId.toString() === store._id.toString());
            return {
                storeId: store._id.toString(),
                storeName: store.name,
                storeLogo: store.logoUrl,
                role: storeUser?.role || 'seller',
                joinedAt: storeUser?.joinedAt || new Date().toISOString(),
                permissions: storeUser?.permissions || [],
                isOpen: store.isOpen || false,
                lastOpenedAt: store.lastOpenedAt,
                lastClosedAt: store.lastClosedAt
            };
        });

        console.log('[API] Returning userStores:', userStores.map(s => `${s.storeName}: ${s.isOpen}`));

        // Find owned stores
        const ownedStores = storeUsers
            .filter(su => su.role === 'owner')
            .map(su => su.storeId.toString());

        // Get user preference for active store
        const user = await User.findById(userId).select('storeId');

        let activeStoreId = user?.storeId;

        // Verify if user still has access to this store
        const hasAccess = userStores.some(s => s.storeId === activeStoreId);

        if (!activeStoreId || !hasAccess) {
            // Fallback to first owned store or first available store
            activeStoreId = ownedStores[0] || (userStores[0]?.storeId);
        }

        res.json({
            status: 'success',
            data: {
                stores: userStores,
                activeStoreId,
                ownedStores
            }
        });
    } catch (error) {
        console.error('Error fetching user stores:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao buscar lojas do usuário' });
    }
});

// --- SECURE SUBSCRIPTION ACTIVATION (CAKTO ONLY) ---
app.post('/api/users/:id/activate-subscription', async (req, res) => {
    try {
        const { id } = req.params;
        const user = await User.findById(id);

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'Usuário não encontrado.' });
        }

        // NOTE: This endpoint used to verify with AbacatePay.
        // Since migration to Cakto, subscription activation should utilize Cakto Webhooks
        // or a specific manual verification against Cakto API if needed.

        // For now, blocking direct activation without a valid payment flow.
        return res.status(400).json({
            status: 'error',
            message: 'Ativação direta descontinuada. Use o fluxo de checkout da Cakto.'
        });

    } catch (error) {
        console.error('Subscription activation error:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao ativar assinatura.' });
    }
});

// --- CAKTO WEBHOOK ENDPOINT ---
app.post('/api/webhooks/cakto', async (req, res) => {
    try {
        console.log('📨 Webhook CAKTO recebido:', JSON.stringify(req.body, null, 2));

        const event = req.body;

        // Validar estrutura básica do webhook
        if (!event || !event.event) {
            console.warn('⚠️  Webhook inválido: estrutura incorreta');
            return res.status(400).json({ error: 'Invalid webhook structure' });
        }

        // Processar evento de compra aprovada
        // CAKTO usa underscore: purchase_approved
        if (event.event === 'purchase_approved' || event.event === 'purchase.approved' || event.event === 'order.approved') {
            console.log('✅ Processando compra aprovada...');

            // Extrair dados do cliente e pedido
            const customerEmail = event.customer?.email || event.data?.customer?.email;
            const orderId = event.order?.id || event.data?.id;
            const amount = event.order?.amount || event.data?.amount || 4990; // R$ 49,90 em centavos

            if (!customerEmail) {
                console.warn('⚠️  Email do cliente não encontrado no webhook');
                return res.status(400).json({ error: 'Customer email not found' });
            }

            console.log(`🔍 Buscando usuário com email: ${customerEmail}`);

            // Buscar usuário por email
            const user = await User.findOne({ email: customerEmail });

            if (!user) {
                console.warn(`⚠️  Usuário não encontrado: ${customerEmail}`);
                return res.status(404).json({ error: 'User not found' });
            }

            console.log(`👤 Usuário encontrado: ${user.name} (${user.id})`);

            // Verificar se já está ativo (evitar duplicação)
            if (user.subscriptionStatus === 'ACTIVE') {
                console.log('ℹ️  Assinatura já está ativa, ignorando webhook');
                return res.status(200).json({ message: 'Already active' });
            }

            // Ativar assinatura
            const nextBilling = new Date();
            nextBilling.setDate(nextBilling.getDate() + 30);

            user.subscriptionStatus = 'ACTIVE';
            user.trialEndsAt = null;
            user.nextBillingAt = nextBilling;

            // Adicionar fatura ao histórico
            user.invoices = user.invoices || [];
            user.invoices.unshift({
                id: orderId || `CAKTO-${Date.now()}`,
                date: new Date(),
                amount: amount / 100, // Converter de centavos para reais
                status: 'PAID',
                method: 'CAKTO'
            });

            await user.save();

            console.log(`🎉 Assinatura ativada com sucesso para ${user.email}`);

            return res.status(200).json({
                status: 'success',
                message: 'Subscription activated',
                userId: user.id
            });
        }

        // Outros eventos (log apenas)
        console.log(`ℹ️  Evento CAKTO recebido: ${event.event} (não processado)`);
        res.status(200).json({ received: true });

    } catch (error) {
        console.error('❌ Erro ao processar webhook CAKTO:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});






// Remover usuário de loja
app.delete('/api/stores/:storeId/users/:userId', async (req, res) => {
    try {
        const { storeId, userId } = req.params;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'Usuário não encontrado.' });
        }

        // Remove store from user's stores array
        user.stores = user.stores?.filter(s => s.storeId !== storeId) || [];

        // If active store was removed, set to first available store
        if (user.activeStoreId === storeId) {
            user.activeStoreId = user.stores.length > 0 ? user.stores[0].storeId : null;
        }

        await user.save();

        // Remove StoreUser junction record
        await StoreUser.deleteOne({ userId, storeId });

        res.json({ status: 'success', message: 'Usuário removido da loja.' });
    } catch (error) {
        console.error('Erro ao remover usuário:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao remover usuário.' });
    }
});

// Listar usuários de uma loja (multi-store aware)
app.get('/api/stores/:storeId/users', async (req, res) => {
    try {
        const { storeId } = req.params;

        // Find all users who have this store in their stores array
        const users = await User.find({ 'stores.storeId': storeId });

        // Map to include store-specific role
        const usersWithRoles = users.map(user => {
            const storeEntry = user.stores?.find(s => s.storeId === storeId);
            return {
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                avatarUrl: user.avatarUrl,
                role: storeEntry?.role || 'seller',
                joinedAt: storeEntry?.joinedAt,
                status: user.status
            };
        });

        res.json({ status: 'success', data: usersWithRoles });
    } catch (error) {
        console.error('Erro ao listar usuários da loja:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao listar usuários.' });
    }
});


// --- GENERIC CRUD HANDLERS ---

const createHandler = (Model) => async (req, res) => {
    try {
        const { storeId } = req.params;
        const item = new Model({ ...req.body, storeId });
        await item.save();
        res.status(201).json({ status: 'success', data: item });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

const listHandler = (Model) => async (req, res) => {
    try {
        const { storeId } = req.params;
        const items = await Model.find({ storeId }).sort({ date: -1, createdAt: -1 });
        res.json({ status: 'success', data: items });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

const updateHandler = (Model) => async (req, res) => {
    try {
        const { id } = req.params;
        const item = await Model.findByIdAndUpdate(id, req.body, { new: true });
        res.json({ status: 'success', data: item });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

const deleteHandler = (Model) => async (req, res) => {
    try {
        const { id } = req.params;
        await Model.findByIdAndDelete(id);
        res.json({ status: 'success' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// --- ROUTES FOR ENTITIES ---

// Products
app.get('/api/stores/:storeId/products', listHandler(Product));
app.post('/api/stores/:storeId/products', createHandler(Product));
app.put('/api/products/:id', updateHandler(Product));
app.delete('/api/products/:id', deleteHandler(Product));

// Transactions
app.get('/api/stores/:storeId/transactions', listHandler(Transaction));
app.post('/api/stores/:storeId/transactions', createHandler(Transaction));
app.put('/api/transactions/:id', updateHandler(Transaction));
app.delete('/api/transactions/:id', deleteHandler(Transaction));

// Customers
app.get('/api/stores/:storeId/customers', listHandler(Customer));
app.post('/api/stores/:storeId/customers', createHandler(Customer));
app.put('/api/customers/:id', updateHandler(Customer));
app.delete('/api/customers/:id', deleteHandler(Customer));

// Service Orders
app.get('/api/stores/:storeId/service-orders', listHandler(ServiceOrder));
app.post('/api/stores/:storeId/service-orders', createHandler(ServiceOrder));
app.put('/api/service-orders/:id', updateHandler(ServiceOrder));
app.delete('/api/service-orders/:id', deleteHandler(ServiceOrder));

// Suppliers
app.get('/api/stores/:storeId/suppliers', listHandler(Supplier));
app.post('/api/stores/:storeId/suppliers', createHandler(Supplier));
app.put('/api/suppliers/:id', updateHandler(Supplier));
app.delete('/api/suppliers/:id', deleteHandler(Supplier));

// Cash Closings
app.get('/api/stores/:storeId/cash-closings', listHandler(CashClosing));
app.post('/api/stores/:storeId/cash-closings', createHandler(CashClosing));
app.put('/api/cash-closings/:id', updateHandler(CashClosing));
app.delete('/api/cash-closings/:id', deleteHandler(CashClosing));

// Bank Accounts
app.get('/api/stores/:storeId/bank-accounts', listHandler(BankAccount));
app.post('/api/stores/:storeId/bank-accounts', createHandler(BankAccount));
app.put('/api/bank-accounts/:id', updateHandler(BankAccount));
app.delete('/api/bank-accounts/:id', deleteHandler(BankAccount));

// Criar Loja
app.post('/api/stores', async (req, res) => {
    try {
        const { name, ownerId, address, phone, logoUrl } = req.body;

        const newStore = new Store({ name, owner: ownerId, address, phone, logoUrl });
        await newStore.save();

        // Add store to owner's stores array (multi-store support)
        if (ownerId) {
            const owner = await User.findById(ownerId);
            if (owner) {
                const storeEntry = {
                    storeId: newStore._id.toString(),
                    storeName: name,
                    storeLogo: logoUrl,
                    role: 'owner',
                    joinedAt: new Date(),
                    permissions: []
                };

                owner.stores = owner.stores || [];
                owner.stores.push(storeEntry);

                // Set as active store if no active store
                if (!owner.activeStoreId) {
                    owner.activeStoreId = newStore._id.toString();
                }

                // Add to owned stores
                owner.ownedStores = owner.ownedStores || [];
                owner.ownedStores.push(newStore._id.toString());

                await owner.save();

                // Create StoreUser junction record
                const storeUser = new StoreUser({
                    userId: ownerId,
                    storeId: newStore._id.toString(),
                    role: 'owner',
                    permissions: []
                });
                await storeUser.save();
            }
        }

        res.status(201).json({ status: 'success', data: newStore });
    } catch (error) {
        console.error('Erro ao criar loja:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao criar loja.' });
    }
});

// Buscar Loja por ID
app.get('/api/stores/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const store = await Store.findById(id);
        if (!store) return res.status(404).json({ status: 'error', message: 'Loja não encontrada.' });
        res.json({ status: 'success', data: store });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Erro ao buscar loja.' });
    }
});

// --- ENDPOINTS ABACATE PAY (REMOVED) ---
// User migrated to CAKTO
// Old endpoints /api/checkout and /api/status removed for security.

// --- INTEGRAÇÃO GOOGLE GEMINI (AI) ---

import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// 1. Previsão de Transação (Texto -> JSON)
app.post('/api/ai/predict-transaction', async (req, res) => {
    try {
        const { input, context } = req.body;
        console.log(`[AI] Predict Transaction: "${input}"`);

        const systemPrompt = `
        ATUE COMO UM ERP FINANCEIRO BRASILEIRO.
        CONTEÚDO RECEBIDO: "${input}"
        CONTEXTO ATUAL: "${context}"

        OBJETIVO: Retornar um JSON Array de objetos de transação.

        REGRAS CRÍTICAS DE PAGAMENTO PARCIAL (CREDIÁRIO/FIADO):
        1. Se o usuário mencionar um valor total e um valor pago (ex: "Total 230, pagou 130", "Deu 130 de entrada"):
           - 'amount': Deve ser APENAS o valor que entrou no caixa (130).
           - 'debtAmount': Deve ser a diferença restante (100).
           - 'customerName': OBRIGATÓRIO identificar o nome do cliente. Se não tiver, use "Cliente Anônimo".
        
        2. Se o usuário disser "Vendi fiado para Maria valor 500":
           - 'amount': 0 (nada entrou no caixa agora).
           - 'debtAmount': 500.
           - 'customerName': "Maria".

        REGRAS DE EXTRAÇÃO DE ITENS:
        - Se disser "Vendi 2 bolsas por 230", items: [{name: "Bolsa", quantity: 2, total: 230}]. O unitPrice é calculado (115).
        - O 'amount' final da transação segue a regra do pagamento parcial acima.

        REGRAS DE PAGAMENTO DE DÍVIDA (RECEBIMENTO DE FIADO):
        - Se o usuário disser "Recebi 50 do João da dívida" ou "João pagou 50":
           - 'action': 'TRANSACTION'
           - 'type': 'INCOME'
           - 'amount': 50
           - 'customerName': "João"
           - 'isDebtPayment': true (Flag IMPORTANTE para abater da conta do cliente)

        EXEMPLO DE RESPOSTA (JSON):
        [
          {
            "action": "TRANSACTION",
            "description": "Venda 2 Bolsas (Parcial)",
            "amount": 130, 
            "debtAmount": 100,
            "customerName": "Camila",
            "type": "INCOME",
            "paymentMethod": "Dinheiro",
            "isDebtPayment": false,
            "items": [{ "name": "Bolsa", "quantity": 2, "unitPrice": 115, "total": 230 }]
          }
        ]
        `;

        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\nCONTEÚDO RECEBIDO: "${input}"` }] }],
            generationConfig: { responseMimeType: 'application/json' }
        });

        const responseText = result.response.text();
        res.json(JSON.parse(responseText));

    } catch (error) {
        console.error("Erro na AI Predict Transaction:", error);
        res.status(500).json({ status: 'error', message: 'Erro ao processar IA.' });
    }
});

// 2. Extração de Documentos (Base64 -> Transações)
app.post('/api/ai/extract-doc', async (req, res) => {
    try {
        const { base64, mimeType, context } = req.body;
        console.log(`[AI] Extract Doc: ${mimeType}`);

        const prompt = `
            ATUE COMO UM EXTRATOR DE DADOS FINANCEIROS.
            Analise este documento (Imagem ou PDF). Pode ser um Extrato Bancário OU uma Nota Fiscal/Recibo de Venda.
            MODO 1: SE FOR EXTRATO BANCÁRIO -> Extraia cada linha de movimentação. Ignore o saldo inicial/final.
            MODO 2: SE FOR NOTA FISCAL -> Extraia CADA ITEM como transação separada.
            Contexto: ${context}.
            RETORNE UM ARRAY JSON PURO:
            [{ "date": "YYYY-MM-DD", "description": "...", "amount": 0.00, "paymentMethod": "..." }]
        `;

        const result = await model.generateContent({
            contents: [
                {
                    role: 'user',
                    parts: [
                        { inlineData: { data: base64, mimeType: mimeType } },
                        { text: prompt }
                    ]
                }
            ],
            generationConfig: { responseMimeType: 'application/json' }
        });

        res.json(JSON.parse(result.response.text()));
    } catch (error) {
        console.error("Erro na AI Extract Doc:", error);
        res.status(500).json({ status: 'error', message: 'Erro ao processar documento.' });
    }
});

// 3. Extração de Produtos (Base64 -> Produtos)
app.post('/api/ai/extract-product', async (req, res) => {
    try {
        const { base64, mimeType } = req.body;
        console.log(`[AI] Extract Product: ${mimeType}`);

        const prompt = `
            ATUE COMO UM ESPECIALISTA EM CADASTRO DE ESTOQUE.
            Analise esta imagem.
            RETORNE UM ARRAY JSON PURO:
            [{ "sku": "...", "name": "...", "stock": 1, "salePrice": 0.00, "costPrice": 0.00, "taxData": { "ncm": "..." } }]
        `;

        const result = await model.generateContent({
            contents: [
                {
                    role: 'user',
                    parts: [
                        { inlineData: { data: base64, mimeType: mimeType } },
                        { text: prompt }
                    ]
                }
            ],
            generationConfig: { responseMimeType: 'application/json' }
        });

        res.json(JSON.parse(result.response.text()));
    } catch (error) {
        console.error("Erro na AI Extract Product:", error);
        res.status(500).json({ status: 'error', message: 'Erro ao processar produto.' });
    }
});

// 4. Insights Financeiros
app.post('/api/ai/insight', async (req, res) => {
    try {
        const { transactions } = req.body;

        const prompt = `
           Analyze these transactions: ${JSON.stringify(transactions)}. 
           Return JSON with keys: title, executiveSummary, trendAnalysis, expenseAnalysis, recommendation.
        `;

        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json' }
        });

        res.json(JSON.parse(result.response.text()));
    } catch (error) {
        console.error("Erro na AI Insight:", error);
        res.status(500).json({ status: 'error', message: 'Erro ao gerar insights.' });
    }
});

// 5. Processamento de Comandos de Texto (Navegação/Ação)
app.post('/api/ai/command', async (req, res) => {
    try {
        const { text } = req.body;
        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: `Process this ERP command: "${text}". Return JSON with 'action' (NAVIGATE, TRANSACTION, etc) and 'targetPage' or 'data'.` }] }],
            generationConfig: { responseMimeType: 'application/json' }
        });
        res.json(JSON.parse(result.response.text()));
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Erro no comando.' });
    }
});

// --- INICIALIZAÇÃO ---
app.listen(port, '0.0.0.0', () => {
    console.log(`\n🚀 Backend CAPI rodando em: http://127.0.0.1:${port}`);
    console.log(`🥑 Integrado com Cakto Pay`);
    console.log(`✨ Gemini AI Ativo`);
    console.log(`🍃 MongoDB Status: ${MONGODB_URI ? 'Tentando conectar...' : 'Desativado (sem URI)'}`);
});
