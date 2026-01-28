import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import session from 'express-session';
import passport from './config/passport.js';

// Prisma Client
import prisma from './prisma/client.js';

// Database (stub for Prisma)
import connectDB from './config/database.js';

// Middleware & Utils
import { authMiddleware, generateToken } from './middleware/auth.js';
import { encrypt, decrypt, hashField } from './utils/encryption.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// Connect to Database (Prisma handles this automatically)
connectDB();

// --- VALIDATORS ---
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

const isValidPhone = (phone) => {
    if (!phone) return false;
    const p = phone.replace(/\D/g, '');
    return p.length >= 10 && p.length <= 11;
};

// Middleware
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true
}));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'capi-session-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Health Check Endpoint
app.get('/api/health', async (req, res) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({
            status: 'ok',
            database: 'connected',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            database: 'disconnected',
            error: error.message
        });
    }
});

// ============================================
// GOOGLE OAUTH ROUTES
// ============================================

// Initiate Google OAuth flow
app.get('/api/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
);

// Google OAuth callback
app.get('/api/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login' }),
    async (req, res) => {
        try {
            // Check if new user
            if (req.user.isNewUser) {
                const googleData = encodeURIComponent(JSON.stringify(req.user.googleData));
                return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/register?google=${googleData}`);
            }

            // Existing user - fetch stores
            const user = req.user;
            const storeAssociations = await prisma.storeUser.findMany({
                where: { userId: user.id },
                include: { store: true }
            });

            const userResponse = {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                status: user.status,
                avatarUrl: user.avatarUrl && user.avatarUrl.length < 1000 ? user.avatarUrl : null,
                subscriptionStatus: user.subscriptionStatus,
                trialEndsAt: user.trialEndsAt,
                memberSince: user.memberSince
            };

            if (storeAssociations.length > 0) {
                userResponse.stores = storeAssociations.map(sa => ({
                    storeId: sa.store.id,
                    storeName: sa.store.name,
                    storeLogo: sa.store.logoUrl && sa.store.logoUrl.length < 1000 ? sa.store.logoUrl : null,
                    role: sa.role,
                    isOpen: sa.store.isOpen || false,
                    joinedAt: sa.joinedAt,
                    permissions: sa.permissions || []
                }));
                userResponse.activeStoreId = storeAssociations[0].store.id;
                userResponse.ownedStores = storeAssociations
                    .filter(sa => sa.role === 'owner')
                    .map(sa => sa.store.id);
            }

            const token = generateToken(user);
            const userData = encodeURIComponent(JSON.stringify({ ...userResponse, token }));
            res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/auth/callback?data=${userData}`);

        } catch (error) {
            console.error('[OAuth Callback] Error:', error);
            res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?error=auth_failed`);
        }
    }
);

// Logout
app.get('/api/auth/logout', (req, res) => {
    req.logout((err) => {
        if (err) {
            return res.status(500).json({ status: 'error', message: 'Logout failed' });
        }
        res.json({ status: 'success', message: 'Logged out successfully' });
    });
});

// ============================================
// AUTHENTICATION ROUTES
// ============================================

// --- GOOGLE AUTH REGISTER ---
app.post('/api/auth/google-register', async (req, res) => {
    try {
        const { googleData, registerData, role } = req.body;
        console.log("📝 Google Register Request:", { googleData, registerData, role });

        if (!googleData || !googleData.email || !googleData.googleId) {
            return res.status(400).json({ status: 'error', message: 'Dados do Google inválidos.' });
        }
        if (!registerData || !registerData.storeName || !registerData.taxId) {
            return res.status(400).json({ status: 'error', message: 'Dados de cadastro incompletos.' });
        }

        // 1. Check for existing user
        const existingEmail = await prisma.user.findUnique({ where: { email: googleData.email } });
        if (existingEmail) {
            return res.status(400).json({ status: 'error', message: 'Email já cadastrado.' });
        }

        // Check CPF
        if (registerData.taxId) {
            const tHash = hashField(registerData.taxId);
            const existingTax = await prisma.user.findUnique({ where: { taxIdHash: tHash } });
            if (existingTax) {
                return res.status(400).json({ status: 'error', message: 'CPF já cadastrado.' });
            }
        }

        // 2. Create User and Store in Transaction
        const now = new Date();
        const trialEnd = new Date();
        trialEnd.setDate(now.getDate() + 2);

        const result = await prisma.$transaction(async (tx) => {
            // A. Create User
            const newUser = await tx.user.create({
                data: {
                    name: registerData.ownerName || googleData.name,
                    email: googleData.email,
                    password: await bcrypt.hash(Math.random().toString(36), 10),
                    phone: registerData.phone ? encrypt(registerData.phone) : null,
                    taxId: registerData.taxId ? encrypt(registerData.taxId) : null,
                    phoneHash: registerData.phone ? hashField(registerData.phone) : null,
                    taxIdHash: registerData.taxId ? hashField(registerData.taxId) : null,
                    role: 'Proprietário',
                    avatarUrl: googleData.photoUrl,
                    googleId: googleData.googleId,
                    status: 'Ativo',
                    subscriptionStatus: 'TRIAL',
                    trialEndsAt: trialEnd,
                    memberSince: now
                }
            });

            // B. Create Store
            const newStore = await tx.store.create({
                data: {
                    name: registerData.storeName,
                    ownerId: newUser.id,
                    logoUrl: registerData.logoUrl || null
                }
            });

            // C. Update User with ActiveStoreId
            await tx.user.update({
                where: { id: newUser.id },
                data: { activeStoreId: newStore.id }
            });

            // D. Create StoreUser relation
            await tx.storeUser.create({
                data: {
                    userId: newUser.id,
                    storeId: newStore.id,
                    role: 'owner',
                    permissions: ['all']
                }
            });

            return { user: newUser, store: newStore };
        });

        // 3. Generate Token and Return
        const token = generateToken(result.user);

        console.log("✅ Google Register Success:", result.user.email);
        res.status(201).json({
            status: 'success',
            data: {
                user: result.user,
                token,
                store: result.store
            }
        });

    } catch (error) {
        console.error('❌ Erro no Google Register:', error);
        res.status(500).json({ status: 'error', message: 'Erro interno ao realizar cadastro.' });
    }
});

// --- TRADITIONAL LOGIN ---
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ status: 'error', message: 'Email e senha são obrigatórios.' });
        }

        const user = await prisma.user.findUnique({ where: { email } });

        if (!user) {
            return res.status(401).json({ status: 'error', message: 'Email ou senha incorretos.' });
        }

        // Check password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ status: 'error', message: 'Email ou senha incorretos.' });
        }

        // Generate token
        const token = generateToken(user);

        res.json({
            status: 'success',
            data: { ...user, token }
        });

    } catch (error) {
        console.error('❌ Login Error:', error);
        res.status(500).json({ status: 'error', message: 'Erro interno no servidor.' });
    }
});

// ============================================
// USER ROUTES
// ============================================

// Get user stores
app.get('/api/users/:userId/stores', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;

        const storeAssociations = await prisma.storeUser.findMany({
            where: { userId },
            include: { store: true }
        });

        const stores = storeAssociations.map(sa => ({
            storeId: sa.store.id,
            storeName: sa.store.name,
            storeLogo: sa.store.logoUrl,
            role: sa.role,
            permissions: sa.permissions,
            isOpen: sa.store.isOpen
        }));

        const ownedStores = stores.filter(s => s.role === 'owner').map(s => s.storeId);
        const activeStoreId = stores.length > 0 ? stores[0].storeId : null;

        res.json({
            status: 'success',
            data: { stores, ownedStores, activeStoreId }
        });

    } catch (error) {
        console.error('❌ Error fetching user stores:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao buscar lojas.' });
    }
});

// Update user
app.put('/api/users/:userId', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        const updates = req.body;

        // Encrypt sensitive fields if provided
        if (updates.phone) {
            updates.phone = encrypt(updates.phone);
            updates.phoneHash = hashField(updates.phone);
        }
        if (updates.taxId) {
            updates.taxId = encrypt(updates.taxId);
            updates.taxIdHash = hashField(updates.taxId);
        }

        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: updates
        });

        res.json({
            status: 'success',
            data: updatedUser
        });

    } catch (error) {
        console.error('❌ Error updating user:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao atualizar usuário.' });
    }
});

// Get user by ID
app.get('/api/users/:userId', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;

        const user = await prisma.user.findUnique({
            where: { id: userId }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'Usuário não encontrado.' });
        }

        res.json({
            status: 'success',
            data: user
        });

    } catch (error) {
        console.error('❌ Error fetching user:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao buscar usuário.' });
    }
});

// ============================================
// STORE ROUTES
// ============================================

// Get store by ID
app.get('/api/stores/:storeId', authMiddleware, async (req, res) => {
    try {
        const { storeId } = req.params;

        const store = await prisma.store.findUnique({
            where: { id: storeId }
        });

        if (!store) {
            return res.status(404).json({ status: 'error', message: 'Loja não encontrada.' });
        }

        res.json({
            status: 'success',
            data: store
        });

    } catch (error) {
        console.error('❌ Error fetching store:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao buscar loja.' });
    }
});

// Create store
app.post('/api/stores', authMiddleware, async (req, res) => {
    try {
        const { name, ownerId, phone, address, logoUrl } = req.body;

        if (!name || !ownerId) {
            return res.status(400).json({ status: 'error', message: 'Nome e ownerId são obrigatórios.' });
        }

        const newStore = await prisma.store.create({
            data: { name, ownerId, phone, address, logoUrl }
        });

        // Create StoreUser relation
        await prisma.storeUser.create({
            data: {
                userId: ownerId,
                storeId: newStore.id,
                role: 'owner',
                permissions: ['all']
            }
        });

        res.status(201).json({
            status: 'success',
            data: newStore
        });

    } catch (error) {
        console.error('❌ Error creating store:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao criar loja.' });
    }
});

// ============================================
// TRANSACTION ROUTES
// ============================================

// Get transactions for a store
app.get('/api/stores/:storeId/transactions', authMiddleware, async (req, res) => {
    try {
        const { storeId } = req.params;

        const transactions = await prisma.transaction.findMany({
            where: { storeId },
            orderBy: { date: 'desc' }
        });

        res.json({
            status: 'success',
            data: transactions
        });

    } catch (error) {
        console.error('❌ Error fetching transactions:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao buscar transações.' });
    }
});

// Create transaction
app.post('/api/stores/:storeId/transactions', authMiddleware, async (req, res) => {
    try {
        const { storeId } = req.params;
        const transactionData = req.body;

        const newTransaction = await prisma.transaction.create({
            data: {
                ...transactionData,
                storeId
            }
        });

        res.status(201).json({
            status: 'success',
            data: newTransaction
        });

    } catch (error) {
        console.error('❌ Error creating transaction:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao criar transação.' });
    }
});

// ============================================
// CUSTOMER ROUTES
// ============================================

// Get customers for a store
app.get('/api/stores/:storeId/customers', authMiddleware, async (req, res) => {
    try {
        const { storeId } = req.params;

        const customers = await prisma.customer.findMany({
            where: { storeId }
        });

        res.json({
            status: 'success',
            data: customers
        });

    } catch (error) {
        console.error('❌ Error fetching customers:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao buscar clientes.' });
    }
});

// Create customer
app.post('/api/stores/:storeId/customers', authMiddleware, async (req, res) => {
    try {
        const { storeId } = req.params;
        const customerData = req.body;

        // Encrypt phone if provided
        if (customerData.phone) {
            customerData.phone = encrypt(customerData.phone);
            customerData.phoneHash = hashField(customerData.phone);
        }

        const newCustomer = await prisma.customer.create({
            data: {
                ...customerData,
                storeId
            }
        });

        res.status(201).json({
            status: 'success',
            data: newCustomer
        });

    } catch (error) {
        console.error('❌ Error creating customer:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao criar cliente.' });
    }
});

// ============================================
// PRODUCT ROUTES
// ============================================

// Get products for a store
app.get('/api/stores/:storeId/products', authMiddleware, async (req, res) => {
    try {
        const { storeId } = req.params;

        const products = await prisma.product.findMany({
            where: { storeId }
        });

        res.json({
            status: 'success',
            data: products
        });

    } catch (error) {
        console.error('❌ Error fetching products:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao buscar produtos.' });
    }
});

// Create product
app.post('/api/stores/:storeId/products', authMiddleware, async (req, res) => {
    try {
        const { storeId } = req.params;
        const productData = req.body;

        const newProduct = await prisma.product.create({
            data: {
                ...productData,
                storeId
            }
        });

        res.status(201).json({
            status: 'success',
            data: newProduct
        });

    } catch (error) {
        console.error('❌ Error creating product:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao criar produto.' });
    }
});

// ============================================
// CAKTO WEBHOOKS
// ============================================

// 🔗 UNIFIED WEBHOOK - Use this single URL in CAKTO dashboard
app.post('/api/webhooks/cakto', async (req, res) => {
    try {
        const { event, payment_id, customer_email, amount, status, reason, metadata } = req.body;

        console.log('[CAKTO Webhook] Event received:', { event, payment_id, customer_email, status });

        // Find user by email
        const user = await prisma.user.findUnique({
            where: { email: customer_email }
        });

        if (!user) {
            console.error('[CAKTO Webhook] User not found:', customer_email);
            return res.status(404).json({ error: 'User not found' });
        }

        // Handle different event types
        const eventType = event || status;

        switch (eventType) {
            case 'payment.approved':
            case 'approved':
            case 'paid':
                // Payment approved - Activate subscription
                const nextBilling = new Date();
                nextBilling.setMonth(nextBilling.getMonth() + 1);

                await prisma.user.update({
                    where: { id: user.id },
                    data: {
                        subscriptionStatus: 'ACTIVE',
                        nextBillingAt: nextBilling
                    }
                });

                // Create invoice record
                await prisma.invoice.create({
                    data: {
                        userId: user.id,
                        date: new Date(),
                        amount: parseFloat(amount || 0),
                        status: 'PAID',
                        method: metadata?.payment_method || 'PIX',
                        url: `https://pay.cakto.com.br/invoice/${payment_id}`
                    }
                });

                console.log('[CAKTO Webhook] ✅ Payment approved - Subscription activated:', user.email);
                break;

            case 'payment.pending':
            case 'pending':
            case 'waiting':
                // Payment pending
                await prisma.user.update({
                    where: { id: user.id },
                    data: { subscriptionStatus: 'PENDING' }
                });
                console.log('[CAKTO Webhook] ⏳ Payment pending:', user.email);
                break;

            case 'payment.failed':
            case 'payment.canceled':
            case 'failed':
            case 'canceled':
            case 'refunded':
                // Payment failed or canceled
                await prisma.user.update({
                    where: { id: user.id },
                    data: { subscriptionStatus: 'CANCELED' }
                });
                console.log('[CAKTO Webhook] ❌ Payment failed/canceled:', user.email, reason || '');
                break;

            default:
                console.log('[CAKTO Webhook] ⚠️ Unknown event type:', eventType);
        }

        res.json({ status: 'success', message: 'Webhook processed successfully' });

    } catch (error) {
        console.error('[CAKTO Webhook] ❌ Error processing webhook:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

// Webhook: Payment Approved (Legacy - kept for compatibility)
app.post('/api/webhooks/cakto/payment-approved', async (req, res) => {
    try {
        const { payment_id, customer_email, amount, metadata } = req.body;

        console.log('[CAKTO Webhook] Payment Approved:', { payment_id, customer_email, amount });

        // 1. Find user by email
        const user = await prisma.user.findUnique({
            where: { email: customer_email }
        });

        if (!user) {
            console.error('[CAKTO Webhook] User not found:', customer_email);
            return res.status(404).json({ error: 'User not found' });
        }

        // 2. Update subscription status
        const nextBilling = new Date();
        nextBilling.setMonth(nextBilling.getMonth() + 1);

        await prisma.user.update({
            where: { id: user.id },
            data: {
                subscriptionStatus: 'ACTIVE',
                nextBillingAt: nextBilling
            }
        });

        // 3. Create invoice record
        await prisma.invoice.create({
            data: {
                userId: user.id,
                date: new Date(),
                amount: parseFloat(amount),
                status: 'PAID',
                method: metadata?.payment_method || 'PIX',
                url: `https://pay.cakto.com.br/invoice/${payment_id}`
            }
        });

        console.log('[CAKTO Webhook] ✅ User subscription activated:', user.email);
        res.json({ status: 'success', message: 'Payment processed successfully' });

    } catch (error) {
        console.error('[CAKTO Webhook] ❌ Error processing payment:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Webhook: Payment Pending
app.post('/api/webhooks/cakto/payment-pending', async (req, res) => {
    try {
        const { payment_id, customer_email } = req.body;

        console.log('[CAKTO Webhook] Payment Pending:', { payment_id, customer_email });

        const user = await prisma.user.findUnique({
            where: { email: customer_email }
        });

        if (user) {
            await prisma.user.update({
                where: { id: user.id },
                data: { subscriptionStatus: 'PENDING' }
            });
            console.log('[CAKTO Webhook] ⏳ User status set to PENDING:', user.email);
        }

        res.json({ status: 'success', message: 'Payment pending registered' });
    } catch (error) {
        console.error('[CAKTO Webhook] ❌ Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Webhook: Payment Failed
app.post('/api/webhooks/cakto/payment-failed', async (req, res) => {
    try {
        const { payment_id, customer_email, reason } = req.body;

        console.log('[CAKTO Webhook] Payment Failed:', { payment_id, customer_email, reason });

        const user = await prisma.user.findUnique({
            where: { email: customer_email }
        });

        if (user) {
            await prisma.user.update({
                where: { id: user.id },
                data: { subscriptionStatus: 'CANCELED' }
            });
            console.log('[CAKTO Webhook] ❌ User subscription canceled:', user.email);
        }

        res.json({ status: 'success', message: 'Payment failure registered' });
    } catch (error) {
        console.error('[CAKTO Webhook] ❌ Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// START SERVER
// ============================================

app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
    console.log(`📊 Database: PostgreSQL (Prisma)`);
    console.log(`🌐 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM signal received: closing HTTP server');
    await prisma.$disconnect();
    process.exit(0);
});
