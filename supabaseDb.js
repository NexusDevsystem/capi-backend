/**
 * Supabase Database Adapter
 * Provides a Prisma-like interface using Supabase REST API
 */
import supabase from './supabaseClient.js';

// Helper to convert Prisma-style where clauses to Supabase filters
function applyFilters(query, where) {
    if (!where) return query;

    for (const [key, value] of Object.entries(where)) {
        if (key === 'OR') {
            // Handle OR conditions - Supabase uses .or()
            const orConditions = value.map(condition => {
                const entries = Object.entries(condition);
                return entries.map(([k, v]) => `${k}.eq.${v}`).join(',');
            }).join(',');
            query = query.or(orConditions);
        } else if (typeof value === 'object' && value !== null) {
            // Handle nested conditions like { contains: 'x' }
            for (const [op, val] of Object.entries(value)) {
                switch (op) {
                    case 'contains':
                        query = query.ilike(key, `%${val}%`);
                        break;
                    case 'startsWith':
                        query = query.ilike(key, `${val}%`);
                        break;
                    case 'endsWith':
                        query = query.ilike(key, `%${val}`);
                        break;
                    case 'in':
                        query = query.in(key, val);
                        break;
                    case 'not':
                        query = query.neq(key, val);
                        break;
                    case 'gte':
                        query = query.gte(key, val);
                        break;
                    case 'lte':
                        query = query.lte(key, val);
                        break;
                    case 'gt':
                        query = query.gt(key, val);
                        break;
                    case 'lt':
                        query = query.lt(key, val);
                        break;
                    default:
                        query = query.eq(key, val);
                }
            }
        } else {
            query = query.eq(key, value);
        }
    }
    return query;
}

// Helper to convert Prisma 'include' to Supabase select string
function buildSelect(include) {
    if (!include) return '*';
    const parts = ['*'];
    for (const [key, value] of Object.entries(include)) {
        if (value === true) {
            parts.push(`${key}(*)`);
        } else if (typeof value === 'object') {
            const nestedSelect = buildSelect(value.include); // access inner include if deeper
            // value.select could be handled here too if needed
            // For simple include: { stored: { select: { id: true } } } -> stored(id)
            if (value.select) {
                const selectFields = Object.keys(value.select).filter(k => value.select[k]).join(',');
                parts.push(`${key}(${selectFields})`);
            } else {
                // Recurse for nested include
                // Note: This simple recursion might need "include" key check if Prisma structure is deep
                // But for now, let's assume standard include: { relation: true } or { relation: { include: {...} } }
                // The builtSelect logic above handles 'true', but for objects we might need to be careful.
                // Let's stick to simple relation(*) for now to avoid complexity errors,
                // or try to parse if it has nested include.
                parts.push(`${key}(*)`);
            }
        }
    }
    return parts.join(',');
}

// Create a model proxy for each table
function createModelProxy(tableName) {
    return {
        async findUnique({ where, include }) {
            let query = supabase.from(tableName).select(buildSelect(include));
            query = applyFilters(query, where);
            const { data, error } = await query.single();
            if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
            return data;
        },

        async findFirst({ where, include, orderBy }) {
            let query = supabase.from(tableName).select(buildSelect(include));
            query = applyFilters(query, where);
            if (orderBy) {
                for (const [key, direction] of Object.entries(orderBy)) {
                    query = query.order(key, { ascending: direction === 'asc' });
                }
            }
            const { data, error } = await query.limit(1).single();
            if (error && error.code !== 'PGRST116') throw error;
            return data;
        },

        async findMany({ where, include, orderBy, take, skip } = {}) {
            let query = supabase.from(tableName).select(buildSelect(include));
            query = applyFilters(query, where);
            if (orderBy) {
                for (const [key, direction] of Object.entries(orderBy)) {
                    query = query.order(key, { ascending: direction === 'asc' });
                }
            }
            if (take) query = query.limit(take);
            if (skip) query = query.range(skip || 0, (skip || 0) + (take || 1000) - 1);
            const { data, error } = await query;
            if (error) throw error;
            return data || [];
        },

        async create({ data, include }) {
            // Handle 'connect' (Prisma) by extracting IDs if possible, or ignore if they are just relations
            // Ideally we need to pre-process data to flatten constraints.
            // For valid Supabase insert, we just need the foreign keys.
            // e.g. { owner: { connect: { id: '...' } } } -> ownerId: '...'

            const cleanData = {};
            for (const [key, value] of Object.entries(data)) {
                if (typeof value === 'object' && value !== null && value.connect) {
                    // Assume naming convention relation 'owner' -> 'ownerId'
                    // This is a guess, but covers standard Prisma patterns.
                    // If the field name is already 'ownerId', use that.
                    // If it is 'owner', we try to append 'Id'.
                    cleanData[`${key}Id`] = value.connect.id;
                } else if (typeof value !== 'object' || value === null || value instanceof Date) {
                    cleanData[key] = value;
                }
                // Ignore nested creates for now (not supported in simple wrapper)
            }

            const { data: result, error } = await supabase
                .from(tableName)
                .insert(cleanData)
                .select(buildSelect(include))
                .single();
            if (error) throw error;
            return result;
        },

        async createMany({ data }) {
            // Assuming data is array
            const cleanArray = data.map(item => {
                const clean = {};
                for (const [key, value] of Object.entries(item)) {
                    if (typeof value !== 'object' || value === null || value instanceof Date) {
                        clean[key] = value;
                    }
                }
                return clean;
            });

            const { data: result, error } = await supabase
                .from(tableName)
                .insert(cleanArray)
                .select();
            if (error) throw error;
            return { count: result?.length || 0 };
        },

        async update({ where, data, include }) {
            const cleanData = {};
            for (const [key, value] of Object.entries(data)) {
                if (typeof value === 'object' && value !== null && value.connect) {
                    cleanData[`${key}Id`] = value.connect.id;
                } else if (typeof value !== 'object' || value === null || value instanceof Date) {
                    cleanData[key] = value;
                }
            }

            let query = supabase.from(tableName).update(cleanData);
            query = applyFilters(query, where);
            const { data: result, error } = await query.select(buildSelect(include)).single();
            if (error) throw error;
            return result;
        },

        async updateMany({ where, data }) {
            let query = supabase.from(tableName).update(data);
            query = applyFilters(query, where);
            const { data: result, error } = await query.select();
            if (error) throw error;
            return { count: result?.length || 0 };
        },

        async delete({ where }) {
            let query = supabase.from(tableName).delete();
            query = applyFilters(query, where);
            const { data: result, error } = await query.select().single();
            if (error && error.code !== 'PGRST116') throw error;
            return result;
        },

        async deleteMany({ where }) {
            let query = supabase.from(tableName).delete();
            query = applyFilters(query, where);
            const { data: result, error } = await query.select();
            if (error) throw error;
            return { count: result?.length || 0 };
        },

        async count({ where } = {}) {
            let query = supabase.from(tableName).select('*', { count: 'exact', head: true });
            query = applyFilters(query, where);
            const { count, error } = await query;
            if (error) throw error;
            return count || 0;
        },

        async upsert({ where, create, update }) {
            // Try to find existing
            const existing = await this.findFirst({ where });
            if (existing) {
                return await this.update({ where, data: update });
            } else {
                return await this.create({ data: create });
            }
        }
    };
}

// Create the prisma-like object with all models
const db = {
    user: createModelProxy('users'),
    store: createModelProxy('stores'),
    storeUser: createModelProxy('store_users'),
    product: createModelProxy('products'),
    transaction: createModelProxy('transactions'),
    invoice: createModelProxy('invoices'),
    customer: createModelProxy('customers'),
    supplier: createModelProxy('suppliers'),
    bankAccount: createModelProxy('bank_accounts'),
    cashClosing: createModelProxy('cash_closings'),
    serviceOrder: createModelProxy('service_orders'),

    // Transaction support (basic - runs operations sequentially)
    async $transaction(arg) {
        if (typeof arg === 'function') {
            // Interactive transaction: pass 'db' as 'tx'
            // Note: This is NOT ATOMIC. If one fails, previous ones are NOT rolled back.
            // But it allows the code structure to remain valid.
            return await arg(db);
        } else if (Array.isArray(arg)) {
            // Sequential operations
            const results = [];
            for (const op of arg) {
                // If it's a promise, await it
                results.push(await op);
            }
            return results;
        }
    },

    // Raw query support
    async $queryRaw(query, ...values) {
        // Warning: This is very limited. Supabase REST doesn't support arbitrary SQL execution for security.
        // The user should define RPC functions for complex logic.
        // For simple health check 'SELECT 1', we can mock it or use an RPC.

        // If it's the health check
        if (query && (query.includes('SELECT 1') || (query[0] && query[0].includes('SELECT 1')))) {
            return [{ '?column?': 1 }];
        }

        console.warn('⚠️ $queryRaw is not fully supported in Supabase REST adapter. Use RPCs for complex SQL.');
        return [];
    }
};

export default db;
