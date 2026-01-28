# CAPI ERP - Backend

Sistema ERP completo para pequenos e médios negócios.

## 🚀 Stack Tecnológico

- **Runtime**: Node.js 18+
- **Framework**: Express.js 5.2.1
- **Banco de Dados**: MongoDB (via Mongoose 9.1.2)
- **Autenticação**: JWT + bcryptjs
- **Criptografia**: AES-256 para dados sensíveis
- **Pagamentos**: Cakto (gateway brasileiro)
- **IA**: Google Gemini API

## 📦 Instalação

```bash
# Instalar dependências
npm install

# Configurar variáveis de ambiente
cp .env.example .env
# Editar .env com suas credenciais
```

## ⚙️ Variáveis de Ambiente

```env
# MongoDB
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/database

# JWT
JWT_SECRET=your_jwt_secret_key

# Encryption (AES-256)
ENCRYPTION_KEY=your_32_character_encryption_key

# Cakto Payment Gateway
CAKTO_CLIENT_ID=your_cakto_client_id
CAKTO_CLIENT_SECRET=your_cakto_client_secret
CAKTO_CHECKOUT_URL=https://checkout.cakto.com.br/your_checkout

# Google Gemini AI
GEMINI_API_KEY=your_gemini_api_key

# Server
PORT=3001
NODE_ENV=development
```

## 🏃 Executar

```bash
# Desenvolvimento (com hot reload)
npm run dev

# Produção
npm start
```

## 📊 Estrutura do Banco de Dados

### Models (Mongoose)

- **User** - Usuários do sistema (com criptografia)
- **Store** - Lojas
- **StoreUser** - Relacionamento multi-store
- **Product** - Produtos
- **Transaction** - Transações financeiras
- **Customer** - Clientes (CRM + Crediário)
- **ServiceOrder** - Ordens de Serviço
- **Supplier** - Fornecedores
- **BankAccount** - Contas Bancárias
- **CashClosing** - Fechamentos de Caixa
- **Invoice** - Faturas de Assinatura

## 🔐 Segurança

- **Criptografia AES-256** para campos sensíveis (CPF, telefone)
- **Blind Indexes** para busca sem descriptografar
- **Senhas** com bcrypt (hash + salt)
- **JWT** para autenticação stateless
- **Middleware** de autenticação em rotas protegidas

## 📡 API Endpoints

### Autenticação
- `POST /api/auth/google-register` - Registro via Google OAuth
- `POST /api/auth/google` - Login via Google OAuth
- `POST /api/login` - Login tradicional
- `POST /api/users` - Registro tradicional

### Usuários
- `GET /api/users/:id/stores` - Listar lojas do usuário
- `PUT /api/users/:id` - Atualizar usuário
- `PUT /api/users/:userId/active-store` - Trocar loja ativa
- `POST /api/users/hire` - Contratar funcionário
- `DELETE /api/stores/:storeId/users/:userId` - Remover funcionário
- `GET /api/stores/:storeId/team` - Listar equipe

### Produtos
- `GET /api/stores/:storeId/products`
- `POST /api/stores/:storeId/products`
- `PUT /api/products/:id`
- `DELETE /api/products/:id`

### Transações
- `GET /api/stores/:storeId/transactions`
- `POST /api/stores/:storeId/transactions`
- `PUT /api/transactions/:id`
- `DELETE /api/transactions/:id`

### Clientes
- `GET /api/stores/:storeId/customers`
- `POST /api/stores/:storeId/customers`
- `PUT /api/customers/:id`
- `DELETE /api/customers/:id`

### Ordens de Serviço
- `GET /api/stores/:storeId/service-orders`
- `POST /api/stores/:storeId/service-orders`
- `PUT /api/service-orders/:id`
- `DELETE /api/service-orders/:id`

### Fornecedores
- `GET /api/stores/:storeId/suppliers`
- `POST /api/stores/:storeId/suppliers`
- `PUT /api/suppliers/:id`
- `DELETE /api/suppliers/:id`

### Contas Bancárias
- `GET /api/stores/:storeId/bank-accounts`
- `POST /api/stores/:storeId/bank-accounts`
- `PUT /api/bank-accounts/:id`
- `DELETE /api/bank-accounts/:id`

### Fechamentos
- `GET /api/stores/:storeId/cash-closings`
- `POST /api/stores/:storeId/cash-closings`
- `DELETE /api/cash-closings/:id`

### Faturas
- `GET /api/invoices`
- `POST /api/invoices`

### Pagamentos (Cakto)
- `POST /api/cakto/create-checkout`
- `POST /api/cakto/webhook`

## 🚀 Deploy

### Render.com

1. Criar novo Web Service
2. Conectar repositório GitHub
3. Configurar:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Adicionar variáveis de ambiente
5. Deploy!

### MongoDB Atlas

1. Criar cluster gratuito
2. Configurar IP whitelist (0.0.0.0/0 para acesso público)
3. Criar database user
4. Copiar connection string
5. Adicionar ao `.env` como `MONGODB_URI`

## 📝 Licença

Proprietary - Todos os direitos reservados

## 🤝 Suporte

Para suporte, entre em contato via email ou abra uma issue no repositório.
