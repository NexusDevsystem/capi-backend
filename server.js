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

// --- VALIDATORS ---
const isValidCNPJ = (cnpj) => {
    if (!cnpj) return false;
    cnpj = cnpj.replace(/[^\d]+/g, '');
    if (cnpj === '') return false;
    if (cnpj.length !== 14) return false;
    if (/^(\d)\1+$/.test(cnpj)) return false;

    let tamanho = cnpj.length - 2
    let numeros = cnpj.substring(0, tamanho);
    let digitos = cnpj.substring(tamanho);
    let soma = 0;
    let pos = tamanho - 7;
    for (let i = tamanho; i >= 1; i--) {
        soma += parseInt(numeros.charAt(tamanho - i)) * pos--;
        if (pos < 2) pos = 9;
    }
    let resultado = soma % 11 < 2 ? 0 : 11 - soma % 11;
    if (resultado !== parseInt(digitos.charAt(0))) return false;

    tamanho = tamanho + 1;
    numeros = cnpj.substring(0, tamanho);
    soma = 0;
    pos = tamanho - 7;
    for (let i = tamanho; i >= 1; i--) {
        soma += parseInt(numeros.charAt(tamanho - i)) * pos--;
        if (pos < 2) pos = 9;
    }
    resultado = soma % 11 < 2 ? 0 : 11 - soma % 11;
    if (resultado !== parseInt(digitos.charAt(1))) return false;
    return true;
};

const isStrongPassword = (pass) => {
    return pass && pass.length >= 8 && /\d/.test(pass) && /[a-zA-Z]/.test(pass);
};

const isValidPhone = (phone) => {
    if (!phone) return false;
    const p = phone.replace(/\D/g, '');
    return p.length >= 10 && p.length <= 11;
};

const isValidCPF = (cpf) => {
    if (!cpf) return false;
    cpf = cpf.replace(/[^\d]+/g, '');
    if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
    let soma = 0, resto;
    for (let i = 1; i <= 9; i++) soma = soma + parseInt(cpf.substring(i - 1, i)) * (11 - i);
    resto = (soma * 10) % 11;
    if ((resto === 10) || (resto === 11)) resto = 0;
    if (resto !== parseInt(cpf.substring(9, 10))) return false;
    soma = 0;
    for (let i = 1; i <= 10; i++) soma = soma + parseInt(cpf.substring(i - 1, i)) * (12 - i);
    resto = (soma * 10) % 11;
    if ((resto === 10) || (resto === 11)) resto = 0;
    if (resto !== parseInt(cpf.substring(10, 11))) return false;
    return true;
};

import { hashField } from './utils/encryption.js';

// Registrar Usuário (Público)
app.post('/api/users', async (req, res) => {
    try {
        const { name, email, password, phone, taxId, role, storeId, avatarUrl, status } = req.body;

        // Validação básica
        if (!name || !email || !password) {
            return res.status(400).json({ status: 'error', message: 'Dados obrigatórios faltando.' });
        }

        // Validação extra se for Dono
        if (role === 'Proprietário') {
            if (!isValidCNPJ(taxId) && !isValidCPF(taxId)) {
                return res.status(400).json({ status: 'error', message: 'CPF ou CNPJ inválido ou ausente.' });
            }
            if (!isValidPhone(phone)) {
                return res.status(400).json({ status: 'error', message: 'Telefone inválido.' });
            }
        }

        // Verificar se usuário já existe (Email, CNPJ ou Telefone)
        // Usamos hashField para buscar nos índices cegos
        const duplicateQuery = [{ email }];
        if (phone) duplicateQuery.push({ phoneHash: hashField(phone) });
        if (taxId) duplicateQuery.push({ taxIdHash: hashField(taxId) });

        const existingUser = await User.findOne({ $or: duplicateQuery });

        if (existingUser) {
            let msg = 'Usuário já cadastrado.';
            if (existingUser.email === email) msg = 'Email já cadastrado.';
            else if (existingUser.phoneHash === hashField(phone)) msg = 'Telefone já cadastrado.';
            else if (existingUser.taxIdHash === hashField(taxId)) msg = 'CNPJ/CPF já cadastrado.';

            return res.status(400).json({ status: 'error', message: msg });
        }

        // --- LÓGICA DE TRIAL DE 2 DIAS ---
        const now = new Date();
        const trialEnd = new Date();
        trialEnd.setDate(now.getDate() + 2); // +2 dias

        // Nota: O hook pre-save do User vai criptografar phone/taxId e hashear a senha automaticamente.
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

        const userResponse = newUser.toJSON();
        // Password/Hashes already removed by toJSON transform

        // Generate token for auto-login
        const token = generateToken(newUser);

        res.status(201).json({ status: 'success', data: { ...userResponse, token } });
    } catch (error) {
        console.error('Erro ao criar usuário:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao criar usuário.' });
    }
});

// --- ADMIN: Fix Trial Periods (One-time migration) ---
// GET /api/admin/fix-trials?secret=YOUR_SECRET
// Sets trialEndsAt to memberSince + 2 days for all TRIAL users
app.get('/api/admin/fix-trials', async (req, res) => {
    try {
        // Simple secret protection (use env var in production)
        const { secret } = req.query;
        if (secret !== 'capi2024fix') {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        console.log('[ADMIN] Starting trial fix migration...');

        // Find all users in TRIAL status
        const trialUsers = await User.find({ subscriptionStatus: 'TRIAL' });
        console.log(`[ADMIN] Found ${trialUsers.length} users in TRIAL status`);

        let updated = 0;
        const results = [];

        for (const user of trialUsers) {
            const startDate = user.memberSince || user.createdAt || new Date();
            const start = new Date(startDate);

            // Calculate correct end: memberSince + 2 days
            const correctEnd = new Date(start);
            correctEnd.setDate(start.getDate() + 2);

            // Only update if different (more than 1 hour difference)
            const currentEnd = user.trialEndsAt ? new Date(user.trialEndsAt) : null;
            const needsUpdate = !currentEnd || Math.abs(currentEnd.getTime() - correctEnd.getTime()) > 3600000;

            if (needsUpdate) {
                user.trialEndsAt = correctEnd;
                user.nextBillingAt = correctEnd; // Also sync nextBillingAt
                await user.save();
                updated++;
                results.push({
                    email: user.email,
                    memberSince: start.toISOString(),
                    oldTrialEnd: currentEnd ? currentEnd.toISOString() : 'N/A',
                    newTrialEnd: correctEnd.toISOString()
                });
            }
        }

        console.log(`[ADMIN] Updated ${updated} users`);
        res.json({
            success: true,
            message: `Fixed ${updated} user(s) trial periods to 2 days`,
            totalTrialUsers: trialUsers.length,
            updated,
            results
        });
    } catch (error) {
        console.error('[ADMIN] Fix trials error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // 1. Find user by email
        const user = await User.findOne({ email });

        if (!user) {
            return res.status(401).json({ status: 'error', message: 'Email ou senha incorretos.' });
        }

        // 2. Password Check (Secure + Legacy Migration)
        let isMatch = false;

        // A. Check Hash (Standard Secure Login)
        if (user.password.startsWith('$2')) {
            isMatch = await user.comparePassword(password);
        }
        // B. Check Clear Text (Legacy Migration)
        else {
            if (user.password === password) {
                isMatch = true;
                // AUTO-MIGRATE: Hash it now!
                user.password = password; // Setting it triggers Pre-Save hook which hashes it
                await user.save();
                console.log(`[Security] Migrated legacy password for user ${user.email}`);
            }
        }

        if (!isMatch) {
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

        const userResponse = user.toJSON();
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

// --- MANUAL ACTIVATION ENDPOINT (DEV/ADMIN) ---
app.post('/api/activate-by-email', async (req, res) => {
    try {
        const { email } = req.body;
        console.log(`[API] Manual activation request for: ${email}`);

        const user = await User.findOne({ email });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'Usuário não encontrado.' });
        }

        const nextBilling = new Date();
        nextBilling.setDate(nextBilling.getDate() + 30);

        user.subscriptionStatus = 'ACTIVE';
        user.trialEndsAt = null;
        user.nextBillingAt = nextBilling;

        // Add manual invoice record
        user.invoices = user.invoices || [];
        user.invoices.unshift({
            id: `MANUAL-${Date.now()}`,
            date: new Date(),
            amount: 0,
            status: 'PAID',
            method: 'MANUAL',
            url: '#'
        });

        await user.save();
        console.log(`[API] Manually activated subscription for ${user.email}`);

        // Return user data (using toJSON to ensure id is present)
        const userData = user.toJSON();
        delete userData.password;

        res.json({
            status: 'success',
            message: 'Assinatura ativada manualmente com sucesso!',
            user: userData
        });

    } catch (error) {
        console.error('Error in manual activation:', error);
        res.status(500).json({ status: 'error', message: 'Erro interno ao ativar assinatura.' });
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
        console.log('[API] Creating store with body:', req.body);
        const { name, ownerId, address, phone, logoUrl } = req.body;

        if (!ownerId) {
            console.error('[API] Error: ownerId is missing');
            return res.status(400).json({ status: 'error', message: 'Owner ID is required' });
        }

        const newStore = new Store({ name, owner: ownerId, address, phone, logoUrl });
        await newStore.save();
        console.log('[API] Store saved successfully:', newStore._id);

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

        REGRAS CRÍTICAS DE EXTRAÇÃO DE ITENS (MÚLTIPLOS PRODUTOS):
        1. Se o usuário disser "Vendi 1 Caneta por 5, 2 Cadernos por 20 e 1 Capa por 30":
           - 'items': [
               { "name": "Caneta", "quantity": 1, "unitPrice": 5, "total": 5 },
               { "name": "Caderno", "quantity": 2, "unitPrice": 10, "total": 20 },
               { "name": "Capa", "quantity": 1, "unitPrice": 30, "total": 30 }
             ]
           - 'amount': A SOMA dos totais dos itens (5 + 20 + 30 = 55), a menos que especificado venda fiado/parcial.
        
        2. NÃO ignore itens. Se houver 3 produtos diferentes na frase, o array 'items' DEVE ter 3 objetos.

        REGRAS DE PAGAMENTO PARCIAL (CREDIÁRIO/FIADO):
        - Se "Total foi 100, mas pagou só 40":
           - 'amount': 40 (O que entrou no caixa)
           - 'debtAmount': 60 (Dívida restante)
           - 'customerName': "Nome do Cliente" (Obrigatório se tiver dívida)

        REGRAS DE METODO DE PAGAMENTO:
        - Use APENAS: "Pix", "Dinheiro", "Crédito", "Débito", "Boleto", "Outro".

        EXEMPLO DE RESPOSTA (MÚLTIPLOS ITENS):
        [
          {
            "action": "TRANSACTION",
            "description": "Venda Diversos",
            "amount": 55, 
            "type": "INCOME",
            "paymentMethod": "Pix",
            "items": [
               { "name": "Caneta", "quantity": 1, "unitPrice": 5, "total": 5 },
               { "name": "Caderno", "quantity": 2, "unitPrice": 10, "total": 20 }
            ]
          }
        ]
        `;

        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\nCONTEÚDO RECEBIDO: "${input}"` }] }],
            generationConfig: { responseMimeType: 'application/json' }
        });


        const cleanJson = (text) => {
            if (!text) return null;
            return text.replace(/```json/g, '').replace(/```/g, '').trim();
        };

        const responseText = cleanJson(result.response.text());
        console.log('[AI] Raw Response:', result.response.text()); // Debug log

        let parsedData;
        try {
            parsedData = JSON.parse(responseText);
        } catch (e) {
            console.error('[AI] JSON Parse Error. Cleaned text:', responseText);
            throw new Error('Falha ao processar resposta da IA (JSON inválido).');
        }

        res.json(parsedData);

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

        const responseText = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        res.json(JSON.parse(responseText));
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

        const responseText = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        res.json(JSON.parse(responseText));
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

        const responseText = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        res.json(JSON.parse(responseText));
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
        const responseText = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        res.json(JSON.parse(responseText));
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Erro no comando.' });
    }
});

// --- DATABASE CONNECTION ---
if (process.env.MONGODB_URI) {
    mongoose.connect(process.env.MONGODB_URI)
        .then(() => console.log('🍃 MongoDB Conectado com sucesso!'))
        .catch(err => console.error('❌ Erro ao conectar no MongoDB:', err));
} else {
    console.warn('⚠️  MONGODB_URI não definida no .env. O banco de dados não será conectado.');
}

// --- INICIALIZAÇÃO ---
app.listen(port, '0.0.0.0', () => {
    console.log(`\n🚀 Backend CAPI rodando em: http://127.0.0.1:${port}`);
    console.log(`🥑 Integrado com Cakto Pay`);
    console.log(`✨ Gemini AI Ativo`);
    console.log(`🍃 MongoDB Status: ${MONGODB_URI ? 'Tentando conectar...' : 'Desativado (sem URI)'}`);
});
