# CAPI Backend

Backend API para o sistema CAPI - Gestão Inteligente de Vendas com IA.

## 🚀 Tecnologias

- **Node.js** - Runtime JavaScript
- **Express** - Framework web
- **MongoDB** - Banco de dados
- **Mongoose** - ODM para MongoDB
- **Google Gemini AI** - Inteligência Artificial
- **CAKTO** - Gateway de pagamento

## 📋 Pré-requisitos

- Node.js 18+ 
- MongoDB Atlas (ou local)
- Conta CAKTO
- API Key do Google Gemini

## 🔧 Instalação

1. Clone o repositório:
```bash
git clone https://github.com/NexusDevsystem/capi-backend.git
cd capi-backend
```

2. Instale as dependências:
```bash
npm install
```

3. Configure as variáveis de ambiente:
```bash
cp .env.example .env
```

Edite o arquivo `.env` com suas credenciais.

## 🌐 Variáveis de Ambiente

```env
GEMINI_API_KEY=sua_chave_gemini
MONGODB_URI=sua_connection_string_mongodb
CAKTO_CLIENT_ID=seu_client_id_cakto
CAKTO_CLIENT_SECRET=seu_client_secret_cakto
CAKTO_CHECKOUT_URL=sua_url_checkout_cakto
PORT=3001
```

## ▶️ Executar

### Desenvolvimento
```bash
npm start
```

### Produção
```bash
NODE_ENV=production npm start
```

## 📡 Endpoints Principais

### Autenticação
- `POST /api/users` - Criar usuário
- `POST /api/login` - Login

### Lojas
- `GET /api/stores` - Listar lojas
- `POST /api/stores` - Criar loja

### Produtos
- `GET /api/products` - Listar produtos
- `POST /api/products` - Criar produto

### Pagamentos (CAKTO)
- `POST /api/webhooks/cakto` - Webhook CAKTO
- `POST /api/users/:id/activate-subscription` - Ativar assinatura

### IA (Gemini)
- `POST /api/gemini/chat` - Chat com IA

## 🔐 Webhook CAKTO

Configure o webhook no painel CAKTO:

**URL**: `https://seu-dominio.com/api/webhooks/cakto`

**Evento**: Compra aprovada (`purchase_approved`)

## 🚢 Deploy

### Render.com

1. Crie novo Web Service
2. Conecte este repositório
3. Configure variáveis de ambiente
4. Deploy automático!

### Outras Plataformas

- Heroku
- Railway
- Fly.io
- DigitalOcean App Platform

## 📝 Licença

Propriedade de Nexus Dev System

## 👥 Autores

- Nexus Dev System
