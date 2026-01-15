
const BASE_URL = 'http://localhost:3001/api';

async function run() {
    try {
        // 1. Register
        const email = `test_${Date.now()}@capi.com`;
        const password = 'password123';
        console.log(`\n1. Registering user ${email}...`);

        const regRes = await fetch(`${BASE_URL}/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Test User',
                email,
                password,
                phone: '11999999999',
                taxId: '12345678900' // adding taxId to test encryption
            })
        });
        const regData = await regRes.json();
        console.log('Register Response:', JSON.stringify(regData, null, 2));

        if (regData.status !== 'success') {
            throw new Error('Registration failed');
        }

        // 2. Login
        console.log('\n2. Logging in...');
        const loginRes = await fetch(`${BASE_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const loginData = await loginRes.json();
        console.log('Login Response:', JSON.stringify(loginData, null, 2));

        if (loginData.status !== 'success') {
            throw new Error('Login failed');
        }
        const token = loginData.data.token;
        const userId = loginData.data.id;

        // 3. Create Store
        console.log('\n3. Creating Store...');
        const storeRes = await fetch(`${BASE_URL}/stores`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                name: 'Test Store Automated',
                ownerId: userId,
                address: 'Rua Teste, 123'
            })
        });
        const storeData = await storeRes.json();
        console.log('Store Create Response:', JSON.stringify(storeData, null, 2));

        if (storeData.status !== 'success') {
            throw new Error('Store creation failed');
        }

        const storeId = storeData.data.id;

        // 4. List User Stores
        console.log('\n4. Listing User Stores...');
        const storesRes = await fetch(`${BASE_URL}/users/${userId}/stores`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const storesData = await storesRes.json();
        console.log('User Stores Response:', JSON.stringify(storesData, null, 2));

        if (storesData.status !== 'success' || storesData.data.stores.length === 0) {
            throw new Error('Failed to list stores or no stores found');
        }

        // 5. Create a Product (Generic Handler Test)
        console.log('\n5. Creating Product in Store...');
        const productRes = await fetch(`${BASE_URL}/stores/${storeId}/products`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                name: 'Produto Teste',
                costPrice: 10.00,
                salePrice: 20.00,
                stock: 100
            })
        });
        const productData = await productRes.json();
        console.log('Product Create Response:', JSON.stringify(productData, null, 2));

        if (productData.status !== 'success') {
            throw new Error('Product creation failed');
        }

        console.log('\n✅✅ SUCCESS: All Core Flows Validated! ✅✅');

    } catch (error) {
        console.error('\n❌ TEST FAILED:', error.message);
        if (error.cause) console.error(error.cause);
    }
}

run();
