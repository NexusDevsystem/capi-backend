
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

