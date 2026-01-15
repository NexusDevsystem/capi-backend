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

// Create a model proxy for each table
function createModelProxy(tableName) {
    return {
        async findUnique({ where, include }) {
            let query = supabase.from(tableName).select('*');
            query = applyFilters(query, where);
            const { data, error } = await query.single();
            if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
            return data;
        },

        async findFirst({ where, include, orderBy }) {
            let query = supabase.from(tableName).select('*');
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
            let query = supabase.from(tableName).select('*');
            query = applyFilters(query, where);
            if (orderBy) {
                for (const [key, direction] of Object.entries(orderBy)) {
                    query = query.order(key, { ascending: direction === 'asc' });
                }
            }
            if (take) query = query.limit(take);
            if (skip) query = query.range(skip, skip + (take || 1000) - 1);
            const { data, error } = await query;
            if (error) throw error;
            return data || [];
        },

        async create({ data }) {
            const { data: result, error } = await supabase
                .from(tableName)
                .insert(data)
                .select()
                .single();
            if (error) throw error;
            return result;
        },

        async createMany({ data }) {
            const { data: result, error } = await supabase
                .from(tableName)
                .insert(data)
                .select();
            if (error) throw error;
            return { count: result?.length || 0 };
        },

        async update({ where, data }) {
            let query = supabase.from(tableName).update(data);
            query = applyFilters(query, where);
            const { data: result, error } = await query.select().single();
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
    async $transaction(operations) {
        const results = [];
        for (const op of operations) {
            if (typeof op === 'function') {
                results.push(await op(db));
            } else {
                results.push(await op);
            }
        }
        return results;
    },

    // Raw query support
    async $queryRaw(query) {
        const { data, error } = await supabase.rpc('raw_query', { query_text: query });
        if (error) throw error;
        return data;
    }
};

export default db;
