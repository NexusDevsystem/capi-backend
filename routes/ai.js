import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';

const router = express.Router();

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Helper function to call Gemini API
async function callGemini(prompt, systemInstruction = '') {
    try {
        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash-exp",
            systemInstruction: systemInstruction || undefined
        });

        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();

        // Remove markdown code blocks if present
        text = text.replace(/```json\n?|\n?```/g, '').trim();

        // Try to parse as JSON, fallback to raw text
        try {
            return JSON.parse(text);
        } catch {
            console.warn('Failed to parse Gemini response as JSON:', text);
            return { text };
        }
    } catch (error) {
        console.error('Gemini API Error:', error);
        throw new Error('Erro ao processar com IA: ' + error.message);
    }
}

// POST /api/ai/predict-transaction
router.post('/predict-transaction', async (req, res) => {
    try {
        const { input, context } = req.body;

        if (!input) {
            return res.status(400).json({ error: 'Input é obrigatório' });
        }

        const systemInstruction = `Você é um assistente financeiro especializado em comércio brasileiro que analisa comandos em linguagem natural (incluindo gírias, sotaques e português informal) e retorna transações estruturadas.

**REGRAS IMPORTANTES:**
1. Sempre retorne um array JSON válido, sem markdown, explicações ou texto adicional
2. Identifique automaticamente se é RECEITA (venda, entrada) ou DESPESA (compra, gasto, pagamento)
3. Quando houver pagamento parcial, crie DUAS transações:
   - Uma RECEITA com o valor pago
   - Uma transação de CREDIÁRIO (dívida) com o valor restante
4. Aceite qualquer forma de falar: "vendi", "venda", "recebi", "entrou", "comprei", "gastei", "paguei"
5. Reconheça métodos de pagamento: "pix", "dinheiro", "cartão", "crédito", "débito", "fiado"
6. Extraia nomes de clientes mesmo com apelidos ou nomes informais

**EXEMPLOS DE ENTRADA E SAÍDA:**

Entrada: "Vendi uma camisa pra Camila por 10, ela pagou só 5"
Saída:
[
  {
    "action": "TRANSACTION",
    "description": "Venda de camisa para Camila (parcial)",
    "amount": 5,
    "type": "INCOME",
    "category": "Vendas",
    "paymentMethod": "Dinheiro",
    "customerName": "Camila",
    "items": [
      { "name": "Camisa", "quantity": 1, "unitPrice": 10, "total": 10 }
    ]
  },
  {
    "action": "TRANSACTION",
    "description": "Crediário - Camisa (Camila)",
    "amount": 5,
    "type": "INCOME",
    "category": "Crediário",
    "paymentMethod": "Crediário",
    "customerName": "Camila",
    "isDebtPayment": false,
    "debtAmount": 5
  }
]

Entrada: "Recebi 50 pila da Maria do crediário"
Saída:
[
  {
    "action": "TRANSACTION",
    "description": "Pagamento de crediário - Maria",
    "amount": 50,
    "type": "INCOME",
    "category": "Crediário",
    "paymentMethod": "Dinheiro",
    "customerName": "Maria",
    "isDebtPayment": true
  }
]

Entrada: "Comprei mercadoria do fornecedor por 200 no pix"
Saída:
[
  {
    "action": "TRANSACTION",
    "description": "Compra de mercadoria",
    "amount": 200,
    "type": "EXPENSE",
    "category": "Compras",
    "paymentMethod": "Pix"
  }
]

Entrada: "Venda de 3 camisetas a 30 cada no débito"
Saída:
[
  {
    "action": "TRANSACTION",
    "description": "Venda de 3 camisetas",
    "amount": 90,
    "type": "INCOME",
    "category": "Vendas",
    "paymentMethod": "Débito",
    "items": [
      { "name": "Camiseta", "quantity": 3, "unitPrice": 30, "total": 90 }
    ]
  }
]

**FORMATO DE SAÍDA (Array de Objetos):**
[
  {
    "action": "TRANSACTION",
    "description": "descrição clara e objetiva",
    "amount": número (sempre positivo),
    "type": "INCOME" ou "EXPENSE",
    "category": "Vendas" | "Compras" | "Crediário" | "Despesas" | "Serviços",
    "paymentMethod": "Pix" | "Dinheiro" | "Crédito" | "Débito" | "Crediário" | "Outro",
    "customerName": "nome do cliente (se houver)",
    "isDebtPayment": true/false (se for pagamento de dívida existente),
    "debtAmount": número (valor da dívida criada, se aplicável),
    "items": [
      { "name": "nome do item", "quantity": número, "unitPrice": número, "total": número }
    ]
  }
]

Contexto atual do sistema: ${context || 'geral'}`;

        const prompt = `Analise o seguinte comando e extraia TODAS as transações necessárias (lembre-se: vendas parciais geram 2 transações): "${input}"`;

        const result = await callGemini(prompt, systemInstruction);

        // Ensure we return an array
        const transactions = Array.isArray(result) ? result : [result];

        res.json(transactions);
    } catch (error) {
        console.error('Error in predict-transaction:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/ai/command
router.post('/command', async (req, res) => {
    try {
        const { text } = req.body;

        if (!text) {
            return res.status(400).json({ error: 'Text é obrigatório' });
        }

        const systemInstruction = `Você é um assistente que interpreta comandos de navegação e ações do sistema.

IMPORTANTE: Retorne APENAS um objeto JSON válido, sem texto adicional.

Formato de saída:
{
  "action": "NAVIGATE" | "TRANSACTION" | "STOCK" | "OS",
  "targetPage": "dashboard" | "finance" | "products" | "customers" | "reports" | etc,
  "data": {} (dados adicionais se necessário)
}`;

        const prompt = `Interprete o comando: "${text}"`;

        const result = await callGemini(prompt, systemInstruction);

        res.json(result);
    } catch (error) {
        console.error('Error in command:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/ai/extract-doc
router.post('/extract-doc', async (req, res) => {
    try {
        const { base64, mimeType, context } = req.body;

        if (!base64 || !mimeType) {
            return res.status(400).json({ error: 'base64 e mimeType são obrigatórios' });
        }

        const systemInstruction = `Você é um assistente que extrai informações financeiras de documentos (notas fiscais, recibos, etc).

IMPORTANTE: Retorne APENAS um array JSON válido com as transações extraídas.

Formato de saída:
[
  {
    "description": "descrição do item",
    "amount": número,
    "type": "INCOME" | "EXPENSE",
    "category": "categoria",
    "paymentMethod": "método de pagamento"
  }
]`;

        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash-exp",
            systemInstruction
        });

        const imagePart = {
            inlineData: {
                data: base64,
                mimeType: mimeType
            }
        };

        const prompt = `Extraia as transações financeiras deste documento. Contexto: ${context || 'geral'}`;

        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        const text = response.text();

        try {
            const transactions = JSON.parse(text);
            res.json(Array.isArray(transactions) ? transactions : [transactions]);
        } catch {
            res.json([{ text }]);
        }
    } catch (error) {
        console.error('Error in extract-doc:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/ai/extract-product
router.post('/extract-product', async (req, res) => {
    try {
        const { base64, mimeType } = req.body;

        if (!base64 || !mimeType) {
            return res.status(400).json({ error: 'base64 e mimeType são obrigatórios' });
        }

        const systemInstruction = `Você extrai informações de produtos de notas fiscais.

IMPORTANTE: Retorne APENAS um array JSON válido.

Formato:
[
  {
    "name": "nome do produto",
    "quantity": número,
    "unitPrice": número,
    "total": número
  }
]`;

        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash-exp",
            systemInstruction
        });

        const imagePart = {
            inlineData: {
                data: base64,
                mimeType: mimeType
            }
        };

        const result = await model.generateContent(["Extraia os produtos desta nota fiscal", imagePart]);
        const response = await result.response;
        const text = response.text();

        try {
            const products = JSON.parse(text);
            res.json(Array.isArray(products) ? products : [products]);
        } catch {
            res.json([{ text }]);
        }
    } catch (error) {
        console.error('Error in extract-product:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/ai/insight
router.post('/insight', async (req, res) => {
    try {
        const { transactions } = req.body;

        if (!transactions || !Array.isArray(transactions)) {
            return res.status(400).json({ error: 'transactions array é obrigatório' });
        }

        const systemInstruction = `Você é um analista financeiro que gera insights sobre transações.

IMPORTANTE: Retorne APENAS um objeto JSON válido.

Formato:
{
  "summary": "resumo geral",
  "insights": ["insight 1", "insight 2", ...],
  "recommendations": ["recomendação 1", "recomendação 2", ...]
}`;

        const prompt = `Analise estas transações e gere insights: ${JSON.stringify(transactions.slice(0, 50))}`;

        const result = await callGemini(prompt, systemInstruction);

        res.json(result);
    } catch (error) {
        console.error('Error in insight:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
