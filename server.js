import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import prisma from './prismaClient.js';
import { authMiddleware, generateToken } from './middleware/auth.js';
import { encrypt, decrypt, hashField } from './utils/encryption.js';
import bcrypt from 'bcryptjs';

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

// --- HELPER: Format User (Replace Mongoose toJSON) ---
const formatUser = (user) => {
    if (!user) return null;
    const u = { ...user };
    delete u.password;
    delete u.phoneHash;
    delete u.taxIdHash;

    if (u.phone) u.phone = decrypt(u.phone);
    if (u.taxId) u.taxId = decrypt(u.taxId);

    return u;
};

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

// import { hashField } from './utils/encryption.js'; // Moved to top

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

        // 1. Validar duplicidade de usuário (Email ou CPF)
        const existingEmail = await prisma.user.findFirst({ where: { email: googleData.email } });
        if (existingEmail) {
            return res.status(400).json({ status: 'error', message: 'Email já cadastrado.' });
        }

        // Check CPF if provided
        if (registerData.taxId) {
            const tHash = hashField(registerData.taxId);
            const existingTax = await prisma.user.findFirst({ where: { taxIdHash: tHash } });
            if (existingTax) {
                return res.status(400).json({ status: 'error', message: 'CPF já cadastrado.' });
            }
        }

        // 2. Criar Usuário e Loja em Transação (User First -> Store -> Update User)
        const result = await prisma.$transaction(async (tx) => {
            const now = new Date();
            const trialEnd = new Date();
            trialEnd.setDate(now.getDate() + 2);

            // A. Criar Usuário Owner (sem activeStoreId ainda)
            const newUser = await tx.user.create({
                data: {
                    name: registerData.ownerName || googleData.name,
                    email: googleData.email,
                    password: await bcrypt.hash(Math.random().toString(36), 10), // Random pass for Google users
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

            // B. Criar Loja (Vinculando Owner)
            const newStore = await tx.store.create({
                data: {
                    name: registerData.storeName,
                    owner: {
                        connect: { id: newUser.id }
                    },
                    logoUrl: registerData.logoUrl || null
                }
            });

            // C. Atualizar Usuário com ActiveStoreId
            const updatedUser = await tx.user.update({
                where: { id: newUser.id },
                data: { activeStoreId: newStore.id }
            });

            // D. Criar StoreUser relation
            await tx.storeUser.create({
                data: {
                    userId: newUser.id,
                    storeId: newStore.id,
                    role: 'owner',
                    permissions: ['all']
                }
            });

            return { user: updatedUser, store: newStore };
        });

        // 3. Gerar Token e Retornar
        const userFormatted = formatUser(result.user);
        const token = generateToken(result.user);

        console.log("✅ Google Register Success:", userFormatted.email);
        res.status(201).json({ status: 'success', data: { user: userFormatted, token, store: result.store } });

    } catch (error) {
        console.error('❌ Erro no Google Register:', error);
        res.status(500).json({ status: 'error', message: 'Erro interno ao realizar cadastro.' });
    }
});

// Get User Stores - Returns all stores the user has access to
app.get('/api/users/:id/stores', async (req, res) => {
    try {
        const { id } = req.params;

        // Find user with their stores
        const user = await prisma.user.findUnique({
            where: { id },
            include: {
                ownedStores: {
                    select: {
                        id: true,
                        name: true,
                        logoUrl: true,
                        isOpen: true,
                        createdAt: true
                    }
                },
                stores: {
                    include: {
                        store: {
                            select: {
                                id: true,
                                name: true,
                                logoUrl: true,
                                isOpen: true,
                                createdAt: true
                            }
                        }
                    }
                }
            }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'Usuário não encontrado.' });
        }

        // Format owned stores
        const ownedStores = user.ownedStores.map(store => ({
            storeId: store.id,
            storeName: store.name,
            storeLogo: store.logoUrl,
            role: 'owner',
            isOpen: store.isOpen || false,
            joinedAt: store.createdAt.toISOString(),
            permissions: ['all']
        }));

        // Format member stores (from StoreUser)
        const memberStores = user.stores.map(su => ({
            storeId: su.store.id,
            storeName: su.store.name,
            storeLogo: su.store.logoUrl,
            role: su.role,
            isOpen: su.store.isOpen || false,
            joinedAt: su.joinedAt.toISOString(),
            permissions: su.permissions || []
        }));

        // Combine and deduplicate stores
        const allStores = [...ownedStores, ...memberStores];
        const uniqueStores = allStores.reduce((acc, store) => {
            if (!acc.find(s => s.storeId === store.storeId)) {
                acc.push(store);
            }
            return acc;
        }, []);

        res.json({
            status: 'success',
            data: {
                stores: uniqueStores,
                ownedStores: ownedStores,
                activeStoreId: user.activeStoreId || (uniqueStores[0]?.storeId || null)
            }
        });

    } catch (error) {
        console.error('❌ Erro ao buscar lojas do usuário:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao buscar lojas.' });
    }
});



// Registrar Usuário (Público) (Manteiga Existing Code)
app.post('/api/users', async (req, res) => {
    try {
        const { name, email, password, phone, taxId, role, storeId, avatarUrl, status, googleId } = req.body;

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
        const duplicateChecks = [{ email }];
        // Need to check hash because DB stores hashed versions for blind index
        const pHash = phone ? hashField(phone) : null;
        const tHash = taxId ? hashField(taxId) : null;

        if (pHash) duplicateChecks.push({ phoneHash: pHash });
        if (tHash) duplicateChecks.push({ taxIdHash: tHash });

        const existingUser = await prisma.user.findFirst({
            where: { OR: duplicateChecks }
        });

        if (existingUser) {
            let msg = 'Usuário já cadastrado.';
            if (existingUser.email === email) msg = 'Email já cadastrado.';
            else if (existingUser.phoneHash === pHash) msg = 'Telefone já cadastrado.';
            else if (existingUser.taxIdHash === tHash) msg = 'CNPJ/CPF já cadastrado.';

            return res.status(400).json({ status: 'error', message: msg });
        }

        // --- LÓGICA DE TRIAL DE 2 DIAS ---
        const now = new Date();
        const trialEnd = new Date();
        trialEnd.setDate(now.getDate() + 2);

        // Prepare data
        const hashedPassword = await bcrypt.hash(password, 10);
        const encryptedPhone = phone ? encrypt(phone) : null;
        const encryptedTaxId = taxId ? encrypt(taxId) : null;

        const newUser = await prisma.user.create({
            data: {
                name,
                email,
                password: hashedPassword,
                phone: encryptedPhone,
                taxId: encryptedTaxId,
                phoneHash: pHash,
                taxIdHash: tHash,
                role: role || 'user',
                // storeId logic: In Prisma schema we have relation stores/ownedStores.
                // Legacy StoreId field on User? We have generic 'activeStoreId' in schema.
                // Assuming 'storeId' in body means assigning them to a store?
                // Or if role is Owner, maybe creating a placeholder?
                // For now, let's map body.storeId to activeStoreId if present
                activeStoreId: storeId,
                avatarUrl,
                googleId, // <--- ADDED THIS
                status: status || 'Pendente',
                subscriptionStatus: 'TRIAL',
                trialEndsAt: trialEnd,
                memberSince: now,
                nextBillingAt: trialEnd
            }
        });

        // Add to store if provided (Legacy logic might have done this differently, but we have StoreUser)
        // If the user provided storeId and is NOT owner, maybe we should add them to that store?
        // Original logic: "storeId" field in Mongoose was just a string.
        // We will respect that usage by setting activeStoreId, but we might need to create StoreUser relation too?
        // Let's stick to basic User creation first.

        const userResponse = formatUser(newUser);
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

// --- Google Authentication (Check & Login) ---
app.post('/api/auth/google', async (req, res) => {
    try {
        const { email, name, photoUrl, googleId } = req.body;
        console.log(`[AUTH] Google Login attempt: ${email}`);

        if (!email) {
            return res.status(400).json({ status: 'error', message: 'Email é obrigatório.' });
        }

        console.log(`[AUTH] Looking up user with email: "${email}"`);
        let user = await prisma.user.findUnique({ where: { email } });
        console.log(`[AUTH] User lookup result:`, user ? `Found user ID: ${user.id}, Status: ${user.status}` : 'NOT FOUND');

        if (user) {
            // Login existing user
            console.log(`[AUTH] Google User found: ${user.email} (Status: ${user.status})`);

            // Link Google ID if missing
            if (googleId && !user.googleId) {
                user = await prisma.user.update({
                    where: { id: user.id },
                    data: { googleId }
                });
            }

            // Check if user has store associations (as employee or owner)
            const storeAssociations = await prisma.storeUser.findMany({
                where: { userId: user.id },
                include: { store: true }
            });

            // If user was PENDING and now logging in, activate them
            if (user.status === 'Pendente' && storeAssociations.length > 0) {
                console.log(`[AUTH] Activating pending employee: ${email}`);
                user = await prisma.user.update({
                    where: { id: user.id },
                    data: {
                        status: 'Ativo',
                        avatarUrl: photoUrl || user.avatarUrl,
                        name: name || user.name
                    }
                });

                // Update StoreUser status to Active as well
                for (const assoc of storeAssociations) {
                    await prisma.storeUser.update({
                        where: { userId_storeId: { userId: user.id, storeId: assoc.storeId } },
                        data: { status: 'Ativo' }
                    });
                }
            }

            const token = generateToken(user);
            const formattedUser = formatUser(user);

            // Add stores info to user object
            if (storeAssociations.length > 0) {
                formattedUser.stores = storeAssociations.map(sa => ({
                    storeId: sa.store.id,
                    storeName: sa.store.name,
                    storeLogo: sa.store.logoUrl,
                    role: sa.role,
                    isOpen: sa.store.isOpen || false,
                    joinedAt: sa.joinedAt,
                    permissions: sa.permissions || []
                }));
                formattedUser.activeStoreId = storeAssociations[0].storeId;
                formattedUser.ownedStores = storeAssociations
                    .filter(sa => sa.role === 'owner')
                    .map(sa => sa.storeId);
            }

            return res.json({ status: 'success', data: { ...formattedUser, token } });
        } else {
            // DO NOT CREATE - Return New User Status
            console.log(`[AUTH] New Google User identified: ${email}`);

            return res.json({
                status: 'new_user',
                googleData: { email, name, photoUrl, googleId }
            });
        }
    } catch (error) {
        console.error('Google Auth Error:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao autenticar com Google.' });
    }
});

// --- HIRE EMPLOYEE ENDPOINT ---
app.post('/api/users/hire', async (req, res) => {
    try {
        const { storeId, email, role, phone, salary, commission } = req.body;
        if (!email || !storeId) return res.status(400).json({ status: 'error', message: 'Email e Loja são obrigatórios.' });

        console.log(`[API] Hiring employee ${email} for store ${storeId} as ${role}`);

        // 1. Check if user exists
        let user = await prisma.user.findUnique({ where: { email } });

        if (!user) {
            console.log(`[API] User not found. Creating PENDING user for invites.`);
            // Create Pending User with random password
            const password = await bcrypt.hash(Math.random().toString(36) + Date.now().toString(), 10);

            // Handle Phone
            const encryptedPhone = phone ? encrypt(phone) : null;
            const pHash = phone ? hashField(phone) : null;

            user = await prisma.user.create({
                data: {
                    name: email.split('@')[0], // Temporary name from email
                    email,
                    password,
                    phone: encryptedPhone,     // Save phone for new user
                    phoneHash: pHash,
                    role: 'Vendedor', // Default global role
                    status: 'Pendente',
                    subscriptionStatus: 'FREE'
                }
            });
        } else {
            // Update existing user phone if provided and missing
            if (phone && !user.phone) {
                const encryptedPhone = encrypt(phone);
                const pHash = hashField(phone);
                await prisma.user.update({
                    where: { id: user.id },
                    data: { phone: encryptedPhone, phoneHash: pHash }
                });
            }
        }

        // 2. Check if already in store
        const existingMember = await prisma.storeUser.findUnique({
            where: { userId_storeId: { userId: user.id, storeId } }
        });

        if (existingMember) {
            return res.status(400).json({ status: 'error', message: 'Usuário já faz parte da equipe.' });
        }

        // 3. Add to Store
        await prisma.storeUser.create({
            data: {
                userId: user.id,
                storeId,
                role: role || 'Vendedor',
                status: user.status === 'Pendente' ? 'Pendente' : 'Ativo',
                salary: salary ? parseFloat(salary) : null,
                commission: commission ? parseFloat(commission) : null
            }
        });

        console.log(`[API] Employee hired successfully: ${email}`);
        res.json({ status: 'success', message: 'Convite enviado. Usuário adicionado à equipe.' });

    } catch (error) {
        console.error('Erro ao contratar:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao processar contratação.' });
    }
});

// --- REMOVE EMPLOYEE FROM STORE ---
app.delete('/api/stores/:storeId/users/:userId', async (req, res) => {
    try {
        const { storeId, userId } = req.params;

        console.log(`[API] Removing employee ${userId} from store ${storeId}`);
        console.log('[API] Request params:', { storeId, userId });

        // Check if association exists
        const storeUser = await prisma.storeUser.findUnique({
            where: { userId_storeId: { userId, storeId } }
        });

        console.log('[API] Found storeUser:', storeUser);

        if (!storeUser) {
            console.log('[API] StoreUser not found!');
            return res.status(404).json({ status: 'error', message: 'Colaborador não encontrado nesta loja.' });
        }

        // Remove from store
        const deletedStoreUser = await prisma.storeUser.delete({
            where: { userId_storeId: { userId, storeId } }
        });

        console.log('[API] Deleted storeUser:', deletedStoreUser);
        console.log(`[API] Employee ${userId} removed from store ${storeId} successfully`);
        res.json({ status: 'success', message: 'Colaborador removido da equipe.' });

    } catch (error) {
        console.error('[API] Erro ao remover colaborador:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao remover colaborador.' });
    }
});

// --- Google Registration (Finalize) ---
app.post('/api/auth/google-register', async (req, res) => {
    try {
        const { googleData, storeData, role } = req.body;
        const { email, name, photoUrl, googleId } = googleData;

        console.log(`[AUTH] Finalizing Google Registration for: ${email}`);

        // Double check existence
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) return res.status(400).json({ status: 'error', message: 'Usuário já existe.' });

        const now = new Date();
        const trialEnd = new Date();
        trialEnd.setDate(now.getDate() + 2);

        // Generate random secure password
        const randomPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8) + "!1Aa";
        const hashedPassword = await bcrypt.hash(randomPassword, 10);

        // Create User
        const user = await prisma.user.create({
            data: {
                name: storeData.ownerName || name, // Prefer manual name if provided
                email,
                password: hashedPassword,
                avatarUrl: photoUrl,
                role: role || 'owner',
                status: 'Ativo',
                subscriptionStatus: 'TRIAL',
                trialEndsAt: trialEnd,
                nextBillingAt: trialEnd,
                memberSince: now,
                googleId,
                activeStoreId: null, // Will update below
                taxId: storeData.taxId ? encrypt(storeData.taxId) : null,
                taxIdHash: storeData.taxId ? hashField(storeData.taxId) : null,
                phone: storeData.phone ? encrypt(storeData.phone) : null,
                phoneHash: storeData.phone ? hashField(storeData.phone) : null,
            }
        });

        // Create Store (if owner)
        if (storeData.storeName) {
            const store = await prisma.store.create({
                data: {
                    name: storeData.storeName,
                    ownerId: user.id,
                    address: '',
                    logoUrl: storeData.logoUrl || null,
                    isOpen: false
                }
            });

            // Create StoreUser Membership
            await prisma.storeUser.create({
                data: {
                    userId: user.id,
                    storeId: store.id,
                    role: 'owner',
                    permissions: ['all']
                }
            });

            // Update User Active Store
            await prisma.user.update({
                where: { id: user.id },
                data: { activeStoreId: store.id }
            });

            // Inject store info into user object for response
            user.activeStoreId = store.id;
        }

        const token = generateToken(user);
        res.status(201).json({ status: 'success', data: { ...formatUser(user), token } });

    } catch (error) {
        console.error('Google Register Error:', error);
        // Handle unique constraint violations gracefully
        if (error.code === 'P2002') {
            return res.status(400).json({ status: 'error', message: 'Dados duplicados (CPF/Telefone já em uso).' });
        }
        res.status(500).json({ status: 'error', message: 'Erro ao finalizar cadastro.' });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // 1. Find user by email
        const user = await prisma.user.findUnique({ where: { email } });

        if (!user) {
            return res.status(401).json({ status: 'error', message: 'Email ou senha incorretos.' });
        }

        // 2. Password Check (Secure + Legacy Migration)
        let isMatch = false;

        // A. Check Hash (Standard Secure Login)
        if (user.password.startsWith('$2')) {
            isMatch = await bcrypt.compare(password, user.password);
        }
        // B. Check Clear Text (Legacy Migration)
        else {
            if (user.password === password) {
                isMatch = true;
                // AUTO-MIGRATE: Hash it now!
                const hashedPassword = await bcrypt.hash(password, 10);
                await prisma.user.update({
                    where: { id: user.id },
                    data: { password: hashedPassword }
                });
                console.log(`[Security] Migrated legacy password for user ${user.email}`);
            }
        }

        if (!isMatch) {
            return res.status(401).json({ status: 'error', message: 'Email ou senha incorretos.' });
        }

        // --- VERIFICAR EXPIRAÇÃO DO TRIAL ---
        if (user.subscriptionStatus === 'TRIAL' && user.trialEndsAt) {
            const now = new Date();
            // Prisma returns Dates as objects, comparison works fine
            if (now > user.trialEndsAt) {
                await prisma.user.update({
                    where: { id: user.id },
                    data: { subscriptionStatus: 'PENDING' }
                });
                user.subscriptionStatus = 'PENDING';
            }
        }

        const userResponse = formatUser(user);
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

        const user = await prisma.user.update({
            where: { id },
            data: updates
        });
        res.json({ status: 'success', data: formatUser(user) });
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
        // Prisma: StoreUser uses compound ID { userId, storeId }
        const membership = await prisma.storeUser.findUnique({
            where: {
                userId_storeId: { userId, storeId }
            }
        });

        if (!membership) {
            return res.status(403).json({ status: 'error', message: 'User is not a member of this store' });
        }

        // Update active store
        const user = await prisma.user.update({
            where: { id: userId },
            data: { activeStoreId: storeId }
        });

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

        // Find user first to get ID
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (!existingUser) return res.status(404).json({ message: 'Usuário não encontrado.' });

        // Update User active store and role
        const user = await prisma.user.update({
            where: { email },
            data: { activeStoreId: storeId, role, status: 'Ativo' }
        });

        // Ensure StoreUser membership exists
        await prisma.storeUser.upsert({
            where: { userId_storeId: { userId: user.id, storeId } },
            create: {
                userId: user.id,
                storeId,
                role: role || 'seller',
                permissions: [] // Default permissions
            },
            update: {
                role: role || 'seller'
            }
        });

        res.json({ status: 'success', data: formatUser(user) });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Erro ao contratar funcionário.' });
    }
});

// Listar Time da Loja
app.get('/api/stores/:storeId/team', async (req, res) => {
    try {
        const { storeId } = req.params;
        const teamMembers = await prisma.storeUser.findMany({
            where: { storeId },
            include: { user: true }
        });

        // Format users and include role from membership
        const team = teamMembers.map(member => ({
            ...formatUser(member.user),
            role: member.role, // Use role from StoreUser
            joinedAt: member.joinedAt
        }));

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
        const storeUser = await prisma.storeUser.findFirst({
            where: {
                storeId,
                userId,
                role: { in: ['owner', 'manager'] }
            }
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

        const store = await prisma.store.update({
            where: { id: storeId },
            data: {
                isOpen: true,
                lastOpenedAt: new Date(),
                openedBy: userId
            }
        });

        console.log(`[API] Store updated:`, store ? `${store.name} isOpen=${store.isOpen}` : 'Not Found');

        res.json({
            status: 'success',
            message: 'Loja aberta com sucesso',
            data: {
                storeId: store.id,
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
        const storeUser = await prisma.storeUser.findFirst({
            where: {
                storeId,
                userId,
                role: { in: ['owner', 'manager'] }
            }
        });

        if (!storeUser) {
            return res.status(403).json({
                status: 'error',
                message: 'Apenas proprietários e gerentes podem fechar a loja'
            });
        }

        const store = await prisma.store.update({
            where: { id: storeId },
            data: {
                isOpen: false,
                lastClosedAt: new Date(),
                closedBy: userId
            }
        });

        res.json({
            status: 'success',
            message: 'Loja fechada com sucesso',
            data: {
                storeId: store.id,
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



// Helper to fetch user details for response
async function getUserDetails(userId) {
    if (!userId) return null;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
    return user ? { _id: user.id, name: user.name } : null;
}

// Get User Stores with Status - PROTECTED triggers re-read below, moving on...
// Implementation of get status:
app.get('/api/stores/:storeId/status', async (req, res) => {
    try {
        const { storeId } = req.params;

        const store = await prisma.store.findUnique({
            where: { id: storeId },
            select: {
                id: true,
                name: true,
                isOpen: true,
                lastOpenedAt: true,
                lastClosedAt: true,
                openedBy: true,
                closedBy: true
            }
        });

        if (!store) {
            return res.status(404).json({ status: 'error', message: 'Loja não encontrada' });
        }

        const openedByUser = await getUserDetails(store.openedBy);
        const closedByUser = await getUserDetails(store.closedBy);

        res.json({
            status: 'success',
            data: {
                storeId: store.id,
                name: store.name,
                isOpen: store.isOpen,
                lastOpenedAt: store.lastOpenedAt,
                lastClosedAt: store.lastClosedAt,
                openedBy: openedByUser,
                closedBy: closedByUser
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
        const storeUsers = await prisma.storeUser.findMany({
            where: {
                userId,
                role: { in: ['owner', 'manager'] }
            }
        });

        const storeIds = storeUsers.map(su => su.storeId);

        const stores = await prisma.store.findMany({
            where: {
                id: { in: storeIds }
            },
            select: {
                id: true,
                name: true,
                isOpen: true,
                lastOpenedAt: true,
                lastClosedAt: true
            }
        });

        const storesWithRole = stores.map(store => {
            const storeUser = storeUsers.find(su => su.storeId === store.id);
            return {
                ...store,
                _id: store.id, // For compatibility
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
        const storeUsers = await prisma.storeUser.findMany({
            where: { userId }
        });

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
        const stores = await prisma.store.findMany({
            where: { id: { in: storeIds } },
            select: {
                id: true,
                name: true,
                logoUrl: true,
                isOpen: true,
                lastOpenedAt: true,
                lastClosedAt: true
            }
        });

        console.log('[API] Found stores from DB:', stores.map(s => `${s.name} (isOpen: ${s.isOpen})`));

        // Combine store data with user role
        const userStores = stores.map(store => {
            const storeUser = storeUsers.find(su => su.storeId === store.id);
            return {
                storeId: store.id,
                storeName: store.name,
                storeLogo: store.logoUrl,
                role: storeUser?.role || 'seller',
                joinedAt: storeUser?.joinedAt,
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
            .map(su => su.storeId);

        // Get user preference for active store
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { activeStoreId: true }
        });

        let activeStoreId = user?.activeStoreId;

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
        const user = await prisma.user.findUnique({ where: { id } });

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

        const user = await prisma.user.findUnique({ where: { email } });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'Usuário não encontrado.' });
        }

        const nextBilling = new Date();
        nextBilling.setDate(nextBilling.getDate() + 30);

        const invoices = user.invoices || [];
        invoices.unshift({
            id: `MANUAL-${Date.now()}`,
            date: new Date(),
            amount: 0,
            status: 'PAID',
            method: 'MANUAL',
            url: '#'
        });

        const updatedUser = await prisma.user.update({
            where: { id: user.id },
            data: {
                subscriptionStatus: 'ACTIVE',
                trialEndsAt: null,
                nextBillingAt: nextBilling,
                invoices: invoices
            }
        });

        console.log(`[API] Manually activated subscription for ${user.email}`);

        // Return user data
        res.json({
            status: 'success',
            message: 'Assinatura ativada manualmente com sucesso!',
            user: formatUser(updatedUser)
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
            const user = await prisma.user.findUnique({ where: { email: customerEmail } });

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

            // Adicionar fatura ao histórico
            // Note: Prisma JSON fields need to be handled. user.invoices is a JSON array.
            const currentInvoices = Array.isArray(user.invoices) ? user.invoices : [];
            const newInvoice = {
                id: orderId || `CAKTO-${Date.now()}`,
                date: new Date(),
                amount: amount / 100, // Converter de centavos para reais
                status: 'PAID',
                method: 'CAKTO'
            };

            await prisma.user.update({
                where: { id: user.id },
                data: {
                    subscriptionStatus: 'ACTIVE',
                    trialEndsAt: null,
                    nextBillingAt: nextBilling,
                    invoices: [newInvoice, ...currentInvoices]
                }
            });

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

// --- CAKTO STATUS CHECK (POLLING) ---
app.post('/api/check-payment-status', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email required' });

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Check if subscription is active
        // Also check if we have a recent CAKTO invoice
        const isActive = user.subscriptionStatus === 'ACTIVE';

        // Optional: Check specifically for a recent paid invoice if status isn't updated yet? 
        // No, webhook should have updated status. Trust status.

        // Log for debugging
        if (isActive) {
            console.log(`[API] Payment Verification for ${email}: ACTIVE`);
        }

        res.json({
            status: isActive ? 'PAID' : 'PENDING',
            subscriptionStatus: user.subscriptionStatus,
            trialEndsAt: user.trialEndsAt
        });

    } catch (error) {
        console.error('Error checking payment status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});






// Remover usuário de loja
app.delete('/api/stores/:storeId/users/:userId', async (req, res) => {
    try {
        const { storeId, userId } = req.params;

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'Usuário não encontrado.' });
        }

        // If active store was removed, set to null (or handle next store logic if we could iterate relations here easily)
        if (user.activeStoreId === storeId) {
            // We can tries to find another store for the user
            const otherMembership = await prisma.storeUser.findFirst({
                where: { userId, NOT: { storeId } }
            });

            await prisma.user.update({
                where: { id: userId },
                data: { activeStoreId: otherMembership ? otherMembership.storeId : null }
            });
        }

        // Remove StoreUser junction record
        await prisma.storeUser.delete({
            where: { userId_storeId: { userId, storeId } }
        });

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

        // Find users via StoreUser relation
        const storeUsers = await prisma.storeUser.findMany({
            where: { storeId },
            include: { user: true }
        });

        // Map to include store-specific role
        const usersWithRoles = storeUsers.map(su => ({
            ...formatUser(su.user),
            role: su.role,
            joinedAt: su.joinedAt,
            status: su.status
        }));

        res.json({ status: 'success', data: usersWithRoles });
    } catch (error) {
        console.error('Erro ao listar usuários da loja:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao listar usuários.' });
    }
});


// --- GENERIC CRUD HANDLERS ---

// --- GENERIC CRUD HANDLERS (PRISMA) ---

const createHandler = (modelName) => async (req, res) => {
    try {
        const { storeId } = req.params;
        const model = prisma[modelName];
        if (!model) throw new Error(`Model ${modelName} not found`);

        const data = { ...req.body, storeId };
        const item = await model.create({ data });
        res.status(201).json({ status: 'success', data: item });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

const listHandler = (modelName) => async (req, res) => {
    try {
        const { storeId } = req.params;
        const model = prisma[modelName];
        // Note: Sort is not implemented globally due to schema differences.
        const items = await model.findMany({ where: { storeId } });
        res.json({ status: 'success', data: items });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

const updateHandler = (modelName) => async (req, res) => {
    try {
        const { id } = req.params;
        const model = prisma[modelName];
        const item = await model.update({ where: { id }, data: req.body });
        res.json({ status: 'success', data: item });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

const deleteHandler = (modelName) => async (req, res) => {
    try {
        const { id } = req.params;
        const model = prisma[modelName];
        await model.delete({ where: { id } });
        res.json({ status: 'success' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// --- ROUTES FOR ENTITIES ---

// Products
app.get('/api/stores/:storeId/products', listHandler('product'));
app.post('/api/stores/:storeId/products', createHandler('product'));
app.put('/api/products/:id', updateHandler('product'));
app.delete('/api/products/:id', deleteHandler('product'));

// Transactions
app.get('/api/stores/:storeId/transactions', listHandler('transaction'));
app.post('/api/stores/:storeId/transactions', createHandler('transaction'));
app.put('/api/transactions/:id', updateHandler('transaction'));
app.delete('/api/transactions/:id', deleteHandler('transaction'));

// Customers
app.get('/api/stores/:storeId/customers', listHandler('customer'));
app.post('/api/stores/:storeId/customers', createHandler('customer'));
app.put('/api/customers/:id', updateHandler('customer'));
app.delete('/api/customers/:id', deleteHandler('customer'));

// Service Orders
app.get('/api/stores/:storeId/service-orders', listHandler('serviceOrder'));
app.post('/api/stores/:storeId/service-orders', createHandler('serviceOrder'));
app.put('/api/service-orders/:id', updateHandler('serviceOrder'));
app.delete('/api/service-orders/:id', deleteHandler('serviceOrder'));

// Suppliers
app.get('/api/stores/:storeId/suppliers', listHandler('supplier'));
app.post('/api/stores/:storeId/suppliers', createHandler('supplier'));
app.put('/api/suppliers/:id', updateHandler('supplier'));
app.delete('/api/suppliers/:id', deleteHandler('supplier'));

// Cash Closings
app.get('/api/stores/:storeId/cash-closings', listHandler('cashClosing'));
app.post('/api/stores/:storeId/cash-closings', createHandler('cashClosing'));
app.put('/api/cash-closings/:id', updateHandler('cashClosing'));
app.delete('/api/cash-closings/:id', deleteHandler('cashClosing'));

// Bank Accounts
app.get('/api/stores/:storeId/bank-accounts', listHandler('bankAccount'));
app.post('/api/stores/:storeId/bank-accounts', createHandler('bankAccount'));
app.put('/api/bank-accounts/:id', updateHandler('bankAccount'));
app.delete('/api/bank-accounts/:id', deleteHandler('bankAccount'));

// Criar Loja
app.post('/api/stores', async (req, res) => {
    try {
        console.log('[API] Creating store with body:', req.body);
        const { name, ownerId, address, phone, logoUrl } = req.body;

        if (!ownerId) {
            console.error('[API] Error: ownerId is missing');
            return res.status(400).json({ status: 'error', message: 'Owner ID is required' });
        }

        const newStore = await prisma.store.create({
            data: { name, ownerId, address, phone, logoUrl }
        });

        console.log('[API] Store saved successfully:', newStore.id);

        // Add store to owner's stores array (multi-store support)
        if (ownerId) {
            // Create StoreUser junction record
            await prisma.storeUser.create({
                data: {
                    userId: ownerId,
                    storeId: newStore.id,
                    role: 'owner',
                    permissions: []
                }
            });

            // Update user active store if needed
            const owner = await prisma.user.findUnique({ where: { id: ownerId } });
            if (owner && !owner.activeStoreId) {
                await prisma.user.update({
                    where: { id: ownerId },
                    data: { activeStoreId: newStore.id }
                });
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
        const store = await prisma.store.findUnique({ where: { id } });
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

// --- GOOGLE AUTH SYNC (SUPABASE -> BACKEND) ---
app.post('/api/auth/google-sync', async (req, res) => {
    try {
        const { email, name, googleId, avatarUrl } = req.body;

        if (!email) {
            return res.status(400).json({ status: 'error', message: 'Email required' });
        }

        console.log(`[AUTH] Syncing Google User: ${email}`);

        // 1. Check if user exists
        let user = await prisma.user.findUnique({ where: { email } });

        if (user) {
            // Update existing user with Google ID and Avatar if missing
            if (!user.googleId || !user.avatarUrl) {
                user = await prisma.user.update({
                    where: { id: user.id },
                    data: {
                        googleId: googleId || user.googleId,
                        avatarUrl: avatarUrl || user.avatarUrl
                    }
                });
            }

            // 3. Generate App JWT
            const token = generateToken(user);
            const formattedUser = formatUser(user);

            return res.json({
                status: 'success',
                data: { ...formattedUser, token }
            });
        } else {
            // 2. User does NOT exist -> Return "new_user" signal so frontend can redirect to Register Flow
            console.log(`[AUTH] New Google User detected (not created yet): ${email}`);
            return res.json({
                status: 'new_user',
                googleData: {
                    email,
                    name,
                    googleId,
                    avatarUrl
                }
            });
        }

    } catch (error) {
        console.error('Error syncing Google user:', error);
        res.status(500).json({ status: 'error', message: 'Error syncing user' });
    }
});

// --- DATABASE CONNECTION ---
// PostgreSQL via Prisma is initialized in prismaClient.js

// --- INICIALIZAÇÃO ---
app.listen(port, '0.0.0.0', () => {
    console.log(`\n🚀 Backend CAPI rodando em: http://127.0.0.1:${port}`);
    console.log(`🥑 Integrado com Cakto Pay`);
    console.log(`✨ Gemini AI Ativo`);
    console.log(`🐘 PostgreSQL (Prisma) Ativo`);
});
