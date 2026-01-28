# Google OAuth 2.0 - Guia de Configuração

## 🔑 Criar Credenciais no Google Cloud Console

### Passo 1: Acessar o Console
1. Acesse: https://console.cloud.google.com
2. Crie um novo projeto ou selecione um existente
3. Nome sugerido: **CAPI ERP**

### Passo 2: Habilitar APIs
1. No menu lateral, vá em **APIs e Serviços** → **Biblioteca**
2. Procure por **Google+ API**
3. Clique em **Ativar**

### Passo 3: Criar Credenciais OAuth 2.0
1. Vá em **APIs e Serviços** → **Credenciais**
2. Clique em **+ CRIAR CREDENCIAIS** → **ID do cliente OAuth**
3. Se solicitado, configure a **Tela de consentimento OAuth**:
   - Tipo: **Externo**
   - Nome do app: **CAPI ERP**
   - Email de suporte: seu email
   - Domínio autorizado: `capipay.com.br` (ou seu domínio)
   - Email do desenvolvedor: seu email
   - Salvar

### Passo 4: Configurar ID do Cliente OAuth
1. Tipo de aplicativo: **Aplicativo da Web**
2. Nome: **CAPI Web Client**

3. **Origens JavaScript autorizadas**:
   ```
   http://localhost:5173
   https://capipay.com.br
   https://www.capipay.com.br
   ```

4. **URIs de redirecionamento autorizados**:
   ```
   http://localhost:3001/auth/google/callback
   https://api.capipay.com.br/auth/google/callback
   ```

5. Clique em **CRIAR**

### Passo 5: Copiar Credenciais
Após criar, você verá:
- **ID do cliente**: `123456789-abcdefg.apps.googleusercontent.com`
- **Chave secreta do cliente**: `GOCSPX-abc123def456`

---

## ⚙️ Configurar Variáveis de Ambiente

### Backend (.env)

```env
# Google OAuth 2.0
GOOGLE_CLIENT_ID=SEU_CLIENT_ID_AQUI
GOOGLE_CLIENT_SECRET=SUA_CLIENT_SECRET_AQUI

# Desenvolvimento
GOOGLE_CALLBACK_URL=http://localhost:3001/auth/google/callback
FRONTEND_URL=http://localhost:5173

# Produção (comentar em dev, descomentar em prod)
# GOOGLE_CALLBACK_URL=https://api.capipay.com.br/auth/google/callback
# FRONTEND_URL=https://capipay.com.br
```

### Frontend (.env)

```env
# Desenvolvimento
VITE_API_URL=http://localhost:3001

# Produção (comentar em dev, descomentar em prod)
# VITE_API_URL=https://api.capipay.com.br
```

---

## 🚀 Deploy em Produção

### Render (Backend)
1. Vá em **Environment** → **Environment Variables**
2. Adicione:
   ```
   GOOGLE_CLIENT_ID=seu_client_id
   GOOGLE_CLIENT_SECRET=sua_secret
   GOOGLE_CALLBACK_URL=https://api.capipay.com.br/auth/google/callback
   FRONTEND_URL=https://capipay.com.br
   ```

### Vercel (Frontend)
1. Vá em **Settings** → **Environment Variables**
2. Adicione:
   ```
   VITE_API_URL=https://api.capipay.com.br
   ```

---

## ✅ Testar

### Desenvolvimento
1. Backend: `npm run dev` (porta 3001)
2. Frontend: `npm run dev` (porta 5173)
3. Acesse: http://localhost:5173/login
4. Clique em "Entrar com Google"
5. Autorize o app
6. Deve redirecionar de volta autenticado

### Produção
1. Acesse: https://capipay.com.br/login
2. Clique em "Entrar com Google"
3. Autorize o app
4. Deve redirecionar de volta autenticado

---

## 🔒 Segurança

- ✅ Nunca commite o `.env` com credenciais reais
- ✅ Use variáveis de ambiente diferentes para dev/prod
- ✅ Mantenha `GOOGLE_CLIENT_SECRET` privada
- ✅ Configure CORS corretamente no backend
- ✅ Use HTTPS em produção

---

## 📝 Domínios Configurados

**Desenvolvimento:**
- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`

**Produção:**
- Frontend: `https://capipay.com.br`
- Backend: `https://api.capipay.com.br`

---

## ❓ Troubleshooting

### Erro: redirect_uri_mismatch
- Verifique se a URL de callback está exatamente igual no Google Console
- Não esqueça o `http://` ou `https://`
- Verifique se não há barra `/` extra no final

### Erro: access_denied
- Usuário cancelou a autorização
- Tente novamente

### Erro: invalid_client
- `GOOGLE_CLIENT_ID` ou `GOOGLE_CLIENT_SECRET` incorretos
- Verifique as credenciais no `.env`
