import express from 'express';
import { createServer as createViteServer } from 'vite';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import pool from './db.js';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from 'qrcode';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { GoogleGenAI } from '@google/genai';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'backup');
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {
  console.warn(`Could not create ${DATA_DIR}, falling back to local data directory`);
  DATA_DIR = path.join(__dirname, 'data');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

const AI_DATA_DIR = path.join(__dirname, 'wp');
try {
  if (!fs.existsSync(AI_DATA_DIR)) fs.mkdirSync(AI_DATA_DIR, { recursive: true });
} catch (e) {
  console.warn(`Could not create ${AI_DATA_DIR}`);
}

const MEDIA_DIR = path.join(DATA_DIR, 'media');
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

const upload = multer({ dest: MEDIA_DIR });

// No need for sqlite paths
// const db = new sqlite3.Database(path.join(DATA_DIR, 'kanban.db'));
// const aiDb = new sqlite3.Database(path.join(AI_DATA_DIR, 'ai_memory.db'));

// Connection check
pool.query('SELECT NOW()').catch(err => console.error('Postgres connection error:', err));

async function startServer() {
  const app = express();
  const PORT = 3000;
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  app.use(cors());
  app.use(express.json());

  // Serve media files
  app.use('/media', express.static(MEDIA_DIR));

  // Password protection middleware
  const checkPassword = (req, res, next) => {
    const appPassword = process.env.PASSWORD;
    if (!appPassword) return next(); // No password set
    
    // Allow public access to media if needed, or protect it? Let's protect API only for now, media can be protected too.
    if (req.path.startsWith('/api/login')) return next();

    const clientPassword = req.headers['x-app-password'];
    if (clientPassword === appPassword) {
      next();
    } else {
      res.status(401).json({ error: 'Unauthorized' });
    }
  };

  app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (!process.env.PASSWORD || password === process.env.PASSWORD) {
      res.json({ success: true });
    } else {
      res.status(401).json({ error: 'Invalid password' });
    }
  });

  app.use('/api', checkPassword);

  // --- Background Jobs ---
setInterval(() => {
  if (!waClient || waStatus !== 'connected') return;
  
  const now = Date.now();
  
  // Check reminders
  pool.query("SELECT * FROM ai_memory WHERE trigger_at IS NOT NULL AND trigger_at <= $1 AND is_triggered = 0", [now]).then(res => {
    const rows = res.rows;
    if (rows && rows.length > 0) {
      rows.forEach(async (row) => {
        try {
          await waClient.sendMessage('557591167094@c.us', `⏰ *LEMBRETE*\n\n${row.content}`);
          await pool.query("UPDATE ai_memory SET is_triggered = 1 WHERE id = $1", [row.id]);
        } catch (e) {
          console.error('Error sending reminder:', e);
        }
      });
    }
  }).catch(err => console.error('Error checking reminders:', err));

  // Check scheduled messages
  pool.query("SELECT * FROM scheduled_messages WHERE trigger_at <= $1 AND is_triggered = 0", [now]).then(res => {
    const rows = res.rows;
    if (rows && rows.length > 0) {
      rows.forEach(async (row) => {
        try {
          const chatId = `${row.phone}@c.us`;
          await waClient.sendMessage(chatId, row.message);
          await pool.query("UPDATE scheduled_messages SET is_triggered = 1 WHERE id = $1", [row.id]);
          await waClient.sendMessage('557591167094@c.us', `✅ *MENSAGEM AGENDADA ENVIADA*\n\nPara: ${row.phone}\nMensagem: ${row.message}`);
        } catch (e) {
          console.error('Error sending scheduled message:', e);
        }
      });
    }
  }).catch(err => console.error('Error checking scheduled messages:', err));
}, 60000); // Check every minute

// --- API Routes ---
  app.post('/api/copilot', async (req, res) => {
    const { message } = req.body;
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ reply: 'A chave da API do Gemini não está configurada.' });
    }

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const chatsRes = await pool.query(`
          SELECT c.id, c.name, c.phone, c.last_message, c.last_message_time, c.unread_count, col.name as column_name, STRING_AGG(t.name, ',') as tags
          FROM chats c
          LEFT JOIN columns col ON c.column_id = col.id
          LEFT JOIN chat_tags ct ON c.id = ct.chat_id
          LEFT JOIN tags t ON ct.tag_id = t.id
          GROUP BY c.id, col.name
      `);
      const chats = chatsRes.rows;

      const tagsRes = await pool.query("SELECT * FROM tags");
      const tags = tagsRes.rows;

      const recentMessagesRes = await pool.query(`
          SELECT m.body, m.from_me, m.timestamp, c.name as chat_name
          FROM messages m
          JOIN chats c ON m.chat_id = c.id
          ORDER BY m.timestamp DESC
          LIMIT 100
      `);
      const recentMessages = recentMessagesRes.rows;

      const systemInstruction = `Você deve funcionar como um “copiloto” do dashboard.
Data e hora atual: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}

==================================================
OBJETIVO PRINCIPAL
Seu objetivo é ajudar o operador humano a:
Consultar dados de mensagens, contatos, tags e kanban
Resumir conversas ou grupos de conversas em lote
Sugerir respostas para clientes
Classificar contextos operacionais
Identificar pendências, urgências e ações sugeridas
Traduzir pedidos em linguagem natural para intenções estruturadas
Apoiar automações, SEM executar ações perigosas sem confirmação
Você NÃO deve inventar dados.
Você NÃO deve assumir que tem acesso direto ao banco.
Você NÃO deve responder como se soubesse números, quantidades ou registros se eles não forem fornecidos pelo sistema.

DADOS FORNECIDOS PELO SISTEMA NESTE MOMENTO:
Tags existentes: ${JSON.stringify(tags)}
Resumo dos Chats atuais: ${JSON.stringify(chats.map(c => ({
  nome: c.name,
  telefone: c.phone,
  coluna: c.column_name,
  tags: c.tags,
  ultima_mensagem: c.last_message,
  data_ultima_mensagem: new Date(c.last_message_time).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
})))}
Últimas 100 mensagens (contexto recente): ${JSON.stringify(recentMessages.map(m => ({
  chat: m.chat_name,
  enviado_por_mim: m.from_me === 1,
  mensagem: m.body,
  data: new Date(m.timestamp).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
})))}

==================================================
COMPORTAMENTO GERAL
Sempre que receber uma solicitação do usuário, você deve identificar qual é o tipo da solicitação.
Os principais tipos são: CONSULTA, RESUMO, AÇÃO, SUGESTÃO DE RESPOSTA, CLASSIFICAÇÃO, FOLLOW-UP, TRIAGEM, COMANDO OPERACIONAL.
Você deve interpretar o pedido do usuário e responder de forma objetiva, útil, operacional e profissional.
Você deve sempre priorizar: clareza, precisão, segurança, economia de tokens, utilidade prática no contexto de escritório contábil.

==================================================
REGRA MAIS IMPORTANTE
VOCÊ NÃO DEVE “ADIVINHAR” RESULTADOS DO SISTEMA.
Se o usuário pedir algo que depende de dados reais do sistema que não estão nos DADOS FORNECIDOS acima, você deve converter isso em uma intenção estruturada (JSON) para o sistema executar. Ou seja: Você interpreta o pedido, mas NÃO inventa a resposta final se os dados ainda não foram consultados.

MODO 1 — INTERPRETAÇÃO DE COMANDO
Quando o usuário fizer uma pergunta ou ordem relacionada a dados do sistema que não estão no contexto, retorne JSON.
Exemplo: Usuário: "Quantas mensagens recebi ontem?" -> Resposta esperada: "6 mensagens da tag y, 7 mensagens da tag x, 10 mensagens sem tags" (Se os dados estiverem no contexto, responda. Se não, retorne JSON).
IMPORTANTE: Sempre que o pedido depender de dados do sistema, você deve preferir retornar JSON estruturado para que o backend execute a consulta.

MODO 2 — ANÁLISE / RESUMO / RESPOSTA
Quando o sistema já fornecer os dados para análise (como os DADOS FORNECIDOS acima), você deve responder em linguagem natural útil, clara e operacional.

CASOS DE USO PRINCIPAIS: CONTAGEM E CONSULTA, RESUMO EM LOTE, SUGESTÃO DE RESPOSTA, CLASSIFICAÇÃO, AUTOMAÇÕES ASSISTIDAS.

SEGURANÇA E CONTROLE: Você NUNCA deve executar automaticamente ações críticas sem confirmação explícita.
RESPOSTAS AUTOMÁTICAS: Você NÃO deve recomendar resposta automática livre para temas sensíveis como: cálculo de imposto, interpretação tributária, demissão, rescisão, admissão, multa, enquadramento fiscal, obrigações legais específicas.
ESTILO DE RESPOSTA: profissional, objetivo, claro, operacional, útil para ambiente de escritório contábil, sem floreios desnecessários. Quando precisar destacar uma palavra ou frase, utilize sempre negrito com dois asteriscos (exemplo: **palavra**). Não utilize apenas um asterisco para destaque.

FORMATO DE SAÍDA:
Se o pedido for para executar uma ação (enviar mensagem, criar tag, adicionar tag, agendar mensagem), você DEVE retornar APENAS um JSON no seguinte formato, sem formatação markdown (sem \`\`\`json):
Para enviar mensagem: {"command": "SEND_MESSAGE", "params": {"phone": "5511999999999", "message": "Texto da mensagem"}}
Para agendar o envio de uma mensagem: {"command": "SCHEDULE_MESSAGE", "params": {"phone": "5511999999999", "message": "Texto da mensagem", "trigger_at": "2026-05-10T09:00:00"}} (trigger_at é obrigatório e deve estar no formato ISO 8601)
Para criar tag: {"command": "CREATE_TAG", "params": {"name": "Nome da Tag"}}
Para adicionar tag a um contato: {"command": "ADD_TAG", "params": {"phone": "5511999999999", "tag_name": "Nome da Tag"}}
Para adicionar um lembrete/tarefa na memória: {"command": "ADD_MEMORY", "params": {"content": "Lembrar de ligar para o cliente X", "trigger_at": "2026-05-10T09:00:00"}} (trigger_at é opcional, use formato ISO 8601 se o usuário pedir para ser lembrado em uma data/hora específica)

Se for pedido de análise de dados já fornecidos: RETORNE TEXTO CLARO E ÚTIL
Se for pedido de sugestão de resposta: RETORNE SOMENTE A SUGESTÃO DE RESPOSTA
Se for pedido de classificação: RETORNE JSON ESTRUTURADO

REGRA FINAL: Você é um assistente operacional de CRM/WhatsApp para contabilidade. Você não é um atendente do cliente final. Você é um copiloto interno do operador do sistema.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: message,
        config: {
          systemInstruction: systemInstruction
        }
      });

      let replyText = response.text || '';
      
      // Try to parse command
      try {
        const cleanJson = replyText.replace(/```json/g, '').replace(/```/g, '').trim();
        if (cleanJson.startsWith('{') && cleanJson.endsWith('}')) {
          const cmd = JSON.parse(cleanJson);
          
          // Normalize command format
          let command = cmd.command || cmd.intent || cmd.acao;
          let params = cmd.params || cmd.parametros || {};
          
          if (command) {
            if ((command === 'SEND_MESSAGE' || command === 'ENVIAR_MENSAGEM') && waClient && waStatus === 'connected') {
              const phone = params.phone || params.telefone;
              const msgText = params.message || params.mensagem;
              const chatId = `${phone}@c.us`;
              await waClient.sendMessage(chatId, msgText);
              replyText = `✅ Mensagem enviada para ${phone}:\n"${msgText}"`;
            } else if (command === 'SCHEDULE_MESSAGE' || command === 'AGENDAR_MENSAGEM') {
              const phone = params.phone || params.telefone;
              const msgText = params.message || params.mensagem;
              const triggerAtStr = params.trigger_at || params.data_alerta;
              let triggerAt = null;
              if (triggerAtStr) {
                const parsedDate = new Date(triggerAtStr);
                if (!isNaN(parsedDate.getTime())) {
                  triggerAt = parsedDate.getTime();
                }
              }
              
              if (triggerAt && phone && msgText) {
                await pool.query("INSERT INTO scheduled_messages (phone, message, trigger_at, is_triggered, created_at) VALUES ($1, $2, $3, $4, $5)", [phone, msgText, triggerAt, 0, Date.now()]);
                replyText = `✅ Mensagem agendada para ${new Date(triggerAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}:\nPara: ${phone}\n"${msgText}"`;
              } else {
                replyText = `❌ Erro ao agendar mensagem. Verifique se o telefone, mensagem e data/hora estão corretos.`;
              }
            } else if (command === 'CREATE_TAG' || command === 'CRIAR_TAG') {
              const tagName = params.name || params.nome;
              const tagId = `tag-${Date.now()}`;
              const color = '#' + Math.floor(Math.random()*16777215).toString(16);
              await pool.query("INSERT INTO tags (id, name, color) VALUES ($1, $2, $3)", [tagId, tagName, color]);
              io.emit('tags_updated');
              replyText = `✅ Tag "${tagName}" criada com sucesso.`;
            } else if (command === 'ADD_TAG') {
              const phone = params.phone || params.contact_phone;
              const tagName = params.tag_name || params.name;
              // Find chat by phone
              const chatRes = await pool.query("SELECT id FROM chats WHERE phone = $1", [phone]);
              const chat = chatRes.rows[0];
              if (chat) {
                // Find tag by name
                const tagRes = await pool.query("SELECT id FROM tags WHERE name ILIKE $1", [`%${tagName}%`]);
                const tag = tagRes.rows[0];
                if (tag) {
                  await pool.query("INSERT INTO chat_tags (chat_id, tag_id) ON CONFLICT DO NOTHING VALUES ($1, $2)", [chat.id, tag.id]);
                  io.emit('chat_updated', { id: chat.id });
                  replyText = `✅ Tag "${tagName}" adicionada ao contato.`;
                } else {
                  replyText = `❌ Tag "${tagName}" não encontrada.`;
                }
              } else {
                replyText = `❌ Contato com telefone ${phone} não encontrado.`;
              }
            } else if (command === 'ADD_MEMORY') {
              const content = params.content || params.conteudo;
              const triggerAtStr = params.trigger_at || params.data_alerta;
              let triggerAt = null;
              if (triggerAtStr) {
                const parsedDate = new Date(triggerAtStr);
                if (!isNaN(parsedDate.getTime())) {
                  triggerAt = parsedDate.getTime();
                }
              }
              
              await pool.query("INSERT INTO ai_memory (content, created_at, trigger_at, is_triggered) VALUES ($1, $2, $3, $4)", [content, Date.now(), triggerAt, 0]);
              
              if (triggerAt) {
                replyText = `✅ Lembrete agendado para ${new Date(triggerAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}:\n"${content}"`;
              } else {
                replyText = `✅ Lembrete/Tarefa adicionada à minha memória:\n"${content}"`;
              }
              
              if (waClient && waStatus === 'connected') {
                await waClient.sendMessage('557591167094@c.us', `✅ Novo lembrete adicionado via Copiloto:\n"${content}"${triggerAt ? `\nAgendado para: ${new Date(triggerAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : ''}`);
              }
            }
          }
        }
      } catch (e) {
        // Not a JSON or not a valid command, just return the text
      }

      res.json({ reply: replyText });
    } catch (error) {
      console.error('Copilot error:', error);
      res.status(500).json({ reply: 'Erro ao processar a solicitação no copiloto.' });
    }
  });

  app.get('/api/columns', async (req, res) => {
    try {
      const result = await pool.query("SELECT * FROM columns ORDER BY position ASC");
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/columns', async (req, res) => {
    const { id, name, position, color } = req.body;
    try {
      await pool.query("INSERT INTO columns (id, name, position, color) VALUES ($1, $2, $3, $4)", [id, name, position, color || '#e2e8f0']);
      io.emit('columns_updated');
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/columns/:id', async (req, res) => {
    const { name, position, color } = req.body;
    try {
      await pool.query("UPDATE columns SET name = $1, position = $2, color = $3 WHERE id = $4", [name, position, color || '#e2e8f0', req.params.id]);
      io.emit('columns_updated');
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/columns/:id', async (req, res) => {
    const colId = req.params.id;
    try {
      // Find another column to move chats to
      const targetColRes = await pool.query("SELECT id FROM columns WHERE id != $1 ORDER BY position ASC LIMIT 1", [colId]);
      const targetColId = targetColRes.rows[0]?.id;
      
      if (targetColId) {
        await pool.query("UPDATE chats SET column_id = $1 WHERE column_id = $2", [targetColId, colId]);
        await pool.query("DELETE FROM columns WHERE id = $1", [colId]);
        io.emit('columns_updated');
        io.emit('chat_updated'); // Trigger chat refresh
        res.json({ success: true });
      } else {
        res.status(400).json({ error: 'Cannot delete the last column' });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/chats', async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT c.*, STRING_AGG(t.id, ',') as tag_ids
        FROM chats c
        LEFT JOIN chat_tags ct ON c.id = ct.chat_id
        LEFT JOIN tags t ON ct.tag_id = t.id
        GROUP BY c.id
        ORDER BY c.last_message_time DESC NULLS LAST
      `);
      const formattedRows = result.rows.map((r) => ({
        ...r,
        tag_ids: r.tag_ids ? r.tag_ids.split(',') : []
      }));
      res.json(formattedRows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/chats/:id/column', async (req, res) => {
    const { column_id } = req.body;
    try {
      await pool.query("UPDATE chats SET column_id = $1 WHERE id = $2", [column_id, req.params.id]);
      io.emit('chat_updated', { id: req.params.id, column_id });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/chats/:id/name', async (req, res) => {
    const { name } = req.body;
    try {
      await pool.query("UPDATE chats SET name = $1 WHERE id = $2", [name, req.params.id]);
      io.emit('chat_updated', { id: req.params.id, name });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/chats/:id/read', async (req, res) => {
    try {
      await pool.query("UPDATE chats SET unread_count = 0 WHERE id = $1", [req.params.id]);
      io.emit('chat_updated', { id: req.params.id, unread_count: 0 });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/tags', async (req, res) => {
    try {
      const result = await pool.query("SELECT * FROM tags");
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/ai_memory', async (req, res) => {
    try {
      const result = await pool.query("SELECT * FROM ai_memory ORDER BY created_at DESC");
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/ai_memory', async (req, res) => {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Content is required' });
    
    try {
      const result = await pool.query("INSERT INTO ai_memory (content, created_at) VALUES ($1, $2) RETURNING id", [content, Date.now()]);
      res.json({ id: result.rows[0].id, content, created_at: Date.now() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/ai_memory/:id', async (req, res) => {
    try {
      await pool.query("DELETE FROM ai_memory WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/tags', async (req, res) => {
    const { id, name, color } = req.body;
    try {
      await pool.query("INSERT INTO tags (id, name, color) VALUES ($1, $2, $3)", [id, name, color]);
      io.emit('tags_updated');
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/tags/:id', async (req, res) => {
    const { name, color } = req.body;
    try {
      await pool.query("UPDATE tags SET name = $1, color = $2 WHERE id = $3", [name, color, req.params.id]);
      io.emit('tags_updated');
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/tags/:id', async (req, res) => {
    try {
      await pool.query("DELETE FROM chat_tags WHERE tag_id = $1", [req.params.id]);
      await pool.query("DELETE FROM tags WHERE id = $1", [req.params.id]);
      io.emit('tags_updated');
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/chats/:id/tags', async (req, res) => {
    const { tag_id } = req.body;
    try {
      await pool.query("INSERT INTO chat_tags (chat_id, tag_id) ON CONFLICT DO NOTHING VALUES ($1, $2)", [req.params.id, tag_id]);
      io.emit('chat_tags_updated', { chat_id: req.params.id });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/chats/:id/tags/:tag_id', async (req, res) => {
    try {
      await pool.query("DELETE FROM chat_tags WHERE chat_id = $1 AND tag_id = $2", [req.params.id, req.params.tag_id]);
      io.emit('chat_tags_updated', { chat_id: req.params.id });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/chats/:id/messages', async (req, res) => {
    try {
      const result = await pool.query("SELECT * FROM messages WHERE chat_id = $1 ORDER BY timestamp ASC", [req.params.id]);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/system/storage', async (req, res) => {
    try {
      let totalSize = 0;
      if (fs.existsSync(MEDIA_DIR)) {
        const files = fs.readdirSync(MEDIA_DIR);
        for (const file of files) {
          const stats = fs.statSync(path.join(MEDIA_DIR, file));
          totalSize += stats.size;
        }
      }
      res.json({ total_bytes: totalSize });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/media', async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT m.id, m.chat_id, m.media_url, m.media_type, m.media_name, m.timestamp, m.from_me, c.name as chat_name, c.phone as chat_phone
        FROM messages m
        JOIN chats c ON m.chat_id = c.id
        WHERE m.media_url IS NOT NULL
        ORDER BY m.timestamp DESC
      `);
      
      const mediaFiles = result.rows.map(row => {
        let size = 0;
        if (row.media_url) {
          try {
            const filename = row.media_url.replace('/media/', '');
            const filePath = path.join(MEDIA_DIR, filename);
            const stats = fs.statSync(filePath);
            size = stats.size;
          } catch (e) {
            // File might not exist
          }
        }
        return {
          ...row,
          size
        };
      });
      
      res.json(mediaFiles);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/chats/:id/messages', upload.single('media'), async (req, res) => {
    const { body } = req.body;
    const chatId = req.params.id;
    const file = req.file;
    
    try {
      if (waClient && waStatus === 'connected') {
        let sentMsg;
        let mediaUrl = null;
        let mediaType = null;
        let mediaName = null;

        if (file) {
          // Move file to have original extension first so MessageMedia can infer mimetype
          const ext = path.extname(file.originalname);
          const newPath = file.path + ext;
          fs.renameSync(file.path, newPath);
          
          const media = MessageMedia.fromFilePath(newPath);
          media.filename = file.originalname;
          sentMsg = await waClient.sendMessage(chatId, media, { caption: body });
          
          mediaUrl = `/media/${file.filename}${ext}`;
          mediaType = file.mimetype;
          mediaName = file.originalname;
        } else {
          sentMsg = await waClient.sendMessage(chatId, body);
        }
        
        const msgId = sentMsg.id.id;
        const timestamp = Date.now();
        
        await pool.query("INSERT INTO messages (id, chat_id, body, from_me, timestamp, media_url, media_type, media_name) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
          [msgId, chatId, body || '', 1, timestamp, mediaUrl, mediaType, mediaName]);
          
        await pool.query("UPDATE chats SET last_message = $1, last_message_time = $2, last_message_from_me = 1 WHERE id = $3",
          [body || 'Media', timestamp, chatId]);
          
        io.emit('new_message', {
          id: msgId,
          chat_id: chatId,
          body: body || '',
          from_me: 1,
          timestamp,
          media_url: mediaUrl,
          media_type: mediaType,
          media_name: mediaName
        });
        
        res.json({ success: true });
      } else {
        res.status(500).json({ error: 'WhatsApp not connected' });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/media/:id', async (req, res) => {
    const mediaId = req.params.id;
    try {
      const result = await pool.query("SELECT media_url FROM messages WHERE id = $1", [mediaId]);
      const row = result.rows[0];
      if (!row || !row.media_url) return res.status(404).json({ error: 'Media not found' });
      
      const filename = row.media_url.replace('/media/', '');
      const filePath = path.join(MEDIA_DIR, filename);
      
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      
      await pool.query("UPDATE messages SET media_url = NULL, media_type = NULL, media_name = NULL WHERE id = $1", [mediaId]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/chats/:id', async (req, res) => {
    const chatId = req.params.id;
    try {
      await pool.query("DELETE FROM messages WHERE chat_id = $1", [chatId]);
      await pool.query("DELETE FROM chat_tags WHERE chat_id = $1", [chatId]);
      await pool.query("DELETE FROM chats WHERE id = $1", [chatId]);
      io.emit('chat_deleted', { id: chatId });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Companies API ---
  app.get('/api/companies', async (req, res) => {
    try {
      const result = await pool.query("SELECT * FROM companies ORDER BY name ASC");
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/companies', async (req, res) => {
    const { id, name, docNumber, type, email, whatsapp } = req.body;
    try {
      if (id) {
        await pool.query(
          "UPDATE companies SET name = $1, doc_number = $2, type = $3, email = $4, whatsapp = $5 WHERE id = $6",
          [name, docNumber, type, email, whatsapp, id]
        );
        res.json({ success: true, id });
      } else {
        const result = await pool.query(
          "INSERT INTO companies (name, doc_number, type, email, whatsapp) VALUES ($1, $2, $3, $4, $5) RETURNING id",
          [name, docNumber, type, email, whatsapp]
        );
        res.json({ success: true, id: result.rows[0].id });
      }
    } catch (err) {
      console.error('Error saving company:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/companies/:id', async (req, res) => {
    try {
      await pool.query("DELETE FROM companies WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Tasks (Kanban) API ---
  app.get('/api/tasks', async (req, res) => {
    try {
      const result = await pool.query("SELECT * FROM tasks ORDER BY created_at DESC");
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/tasks', async (req, res) => {
    const { id, title, description, status, priority, due_date } = req.body;
    try {
      if (id) {
        await pool.query(
          "UPDATE tasks SET title = $1, description = $2, status = $3, priority = $4, due_date = $5 WHERE id = $6",
          [title, description, status, priority, due_date, id]
        );
        res.json({ success: true, id });
      } else {
        const result = await pool.query(
          "INSERT INTO tasks (title, description, status, priority, due_date, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
          [title, description, status || 'todo', priority || 'medium', due_date, Date.now()]
        );
        res.json({ success: true, id: result.rows[0].id });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/tasks/:id', async (req, res) => {
    try {
      await pool.query("DELETE FROM tasks WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Documents API ---
  app.get('/api/documents/status', async (req, res) => {
    const { competence } = req.query;
    try {
      const result = await pool.query("SELECT * FROM document_status WHERE competence = $1", [competence]);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/documents/status', async (req, res) => {
    const { companyId, category, competence, status } = req.body;
    try {
      await pool.query(`
        INSERT INTO document_status (company_id, category, competence, status)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (company_id, category, competence) DO UPDATE SET status = $4
      `, [companyId, category, competence, status]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Settings API ---
  app.get('/api/settings', async (req, res) => {
    try {
      const result = await pool.query("SELECT * FROM user_settings LIMIT 1");
      res.json(result.rows[0] || {});
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/settings', async (req, res) => {
    const settings = req.body;
    try {
      // Check if settings exist
      const check = await pool.query("SELECT id FROM user_settings LIMIT 1");
      if (check.rows.length > 0) {
        await pool.query(
          "UPDATE user_settings SET company_name = $1, email_config = $2, whatsapp_config = $3, updated_at = $4 WHERE id = $5",
          [settings.company_name, JSON.stringify(settings.email_config), JSON.stringify(settings.whatsapp_config), Date.now(), check.rows[0].id]
        );
      } else {
        await pool.query(
          "INSERT INTO user_settings (company_name, email_config, whatsapp_config, created_at) VALUES ($1, $2, $3, $4)",
          [settings.company_name, JSON.stringify(settings.email_config), JSON.stringify(settings.whatsapp_config), Date.now()]
        );
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Scheduled Messages API ---
  app.get('/api/scheduled', async (req, res) => {
    try {
      const result = await pool.query("SELECT * FROM scheduled_messages ORDER BY trigger_at ASC");
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/scheduled', async (req, res) => {
    const { phone, message, trigger_at } = req.body;
    try {
      const result = await pool.query(
        "INSERT INTO scheduled_messages (phone, message, trigger_at, created_at) VALUES ($1, $2, $3, $4) RETURNING id",
        [phone, message, new Date(trigger_at).getTime(), Date.now()]
      );
      res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/scheduled/:id', async (req, res) => {
    try {
      await pool.query("DELETE FROM scheduled_messages WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Dashboard Stats ---
  app.get('/api/recent-sends', async (req, res) => {
    try {
      const result = await pool.query("SELECT * FROM sent_logs ORDER BY timestamp DESC LIMIT 20");
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- WhatsApp Action Endpoints ---
  app.post('/api/whatsapp/disconnect', async (req, res) => {
    if (waClient) {
      try {
        await waClient.logout();
        await waClient.destroy();
        waClient = null;
        waStatus = 'disconnected';
        io.emit('wa_status', { status: waStatus });
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    } else {
      res.json({ success: true });
    }
  });

  // --- Personal Notes API ---
  app.get('/api/notes', async (req, res) => {
    try {
      const result = await pool.query("SELECT * FROM personal_notes ORDER BY created_at DESC");
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/notes', async (req, res) => {
    const { id, title, content } = req.body;
    try {
      if (id) {
        await pool.query(
          "UPDATE personal_notes SET title = $1, content = $2, updated_at = $3 WHERE id = $4",
          [title, content, Date.now(), id]
        );
        res.json({ success: true, id });
      } else {
        const result = await pool.query(
          "INSERT INTO personal_notes (title, content, created_at, updated_at) VALUES ($1, $2, $3, $4) RETURNING id",
          [title, content, Date.now(), Date.now()]
        );
        res.json({ success: true, id: result.rows[0].id });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/notes/:id', async (req, res) => {
    try {
      await pool.query("DELETE FROM personal_notes WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/history', async (req, res) => {
    try {
      const result = await pool.query("SELECT * FROM chat_history ORDER BY timestamp DESC LIMIT 100");
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- WhatsApp Client Setup ---
  let waClient = null;
  let waStatus = 'disconnected';
  let waQrCode = '';
  let waError = '';

  const getProfilePicUrl = async (client, contactId) => {
    try {
      // First try the native method
      try {
        const url = await client.getProfilePicUrl(contactId);
        if (url) return url;
      } catch (e) {
        // Native method failed, fallback to evaluate
      }

      const url = await client.pupPage.evaluate(async (id) => {
        try {
          const w = window;
          
          // Method 1: Store.ProfilePic.profilePicFind
          if (w.Store && w.Store.ProfilePic && w.Store.ProfilePic.profilePicFind) {
            const chatWid = w.Store.WidFactory.createWid(id);
            if (chatWid && typeof chatWid.isNewsletter === 'undefined') {
              chatWid.isNewsletter = false;
            }
            const res = await w.Store.ProfilePic.profilePicFind(chatWid);
            if (res && res.eurl) return res.eurl;
          }

          // Method 2: Store.ProfilePic.requestProfilePicFromServer
          if (w.Store && w.Store.ProfilePic && w.Store.ProfilePic.requestProfilePicFromServer) {
            const chatWid = w.Store.WidFactory.createWid(id);
            if (chatWid && typeof chatWid.isNewsletter === 'undefined') {
              chatWid.isNewsletter = false;
            }
            const res = await w.Store.ProfilePic.requestProfilePicFromServer(chatWid);
            if (res && res.eurl) return res.eurl;
          }

          // Method 3: Contact model
          if (w.Store && w.Store.Contact) {
            const contact = w.Store.Contact.get(id);
            if (contact && contact.profilePicThumbObj && contact.profilePicThumbObj.eurl) {
              return contact.profilePicThumbObj.eurl;
            }
          }

          return null;
        } catch (err) {
          return null;
        }
      }, contactId);
      return url || null;
    } catch (err) {
      console.error(`Error getting profile pic for ${contactId}:`, err);
      return null;
    }
  };

  const downloadProfilePic = async (url, chatId) => {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://web.whatsapp.com/'
        }
      });

      const safeId = chatId.replace(/[@.]/g, '_');
      const filename = `profile_${safeId}.jpg`;
      const filepath = path.join(MEDIA_DIR, filename);

      fs.writeFileSync(filepath, Buffer.from(response.data));

      // Append timestamp to break browser cache
      return `/media/${filename}?t=${Date.now()}`;
    } catch (err) {
      console.error(`Erro ao baixar foto de perfil (${chatId}):`, err);
      return null;
    }
  };

  const syncChatProfilePic = async (chatId) => {
    if (!waClient || waStatus !== 'connected') return null;

    try {
      const chat = await waClient.getChatById(chatId);
      let name = chat.name || '';
      
      try {
        const contact = await chat.getContact();
        if (contact) {
          name = contact.name || contact.pushname || contact.number || name;
        }
      } catch (e) {
        // Ignore error for @lid contacts or other special contacts
      }
      
      let profilePicUrl = await getProfilePicUrl(waClient, chatId);
      if (!profilePicUrl) {
        profilePicUrl = await waClient.getProfilePicUrl(chatId).catch(() => null);
      }

      let profilePic = null;
      if (profilePicUrl) {
        profilePic = await downloadProfilePic(profilePicUrl, chatId);
      }

      try {
        await pool.query(
          "UPDATE chats SET profile_pic = $1, name = $2 WHERE id = $3",
          [profilePic || null, name, chatId]
        );

          io.emit('chat_updated', {
            id: chatId,
            name: name,
            profile_pic: profilePic || null
          });
      } catch (err) {
        console.error(`Error updating chat info for ${chatId}:`, err);
      }

      return profilePic || null;
    } catch (error) {
      console.error(`Error syncing chat info for ${chatId}:`, error);
      return null;
    }
  };

  app.post('/api/chats/:id/sync-profile-pic', async (req, res) => {
    const chatId = req.params.id;

    if (!waClient || waStatus !== 'connected') {
      return res.status(400).json({ error: 'WhatsApp not connected' });
    }

    try {
      const profilePic = await syncChatProfilePic(chatId);

      res.json({
        success: true,
        profile_pic: profilePic
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/chats/sync-all-profile-pics', async (req, res) => {
    if (!waClient || waStatus !== 'connected') {
      return res.status(400).json({ error: 'WhatsApp not connected' });
    }

    const result = await pool.query("SELECT id FROM chats");
    const rows = result.rows;

    try {
      for (const row of rows) {
        await syncChatProfilePic(row.id);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      res.json({ success: true, total: rows.length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  const initWhatsApp = () => {
    console.log('Initializing WhatsApp Client...');
    waStatus = 'initializing';
    waError = '';
    io.emit('wa_status', { status: waStatus });

    const authPath = path.join(DATA_DIR, 'wa_auth');
    try {
      const lockFiles = [
        path.join(authPath, 'session', 'SingletonLock'),
        path.join(authPath, 'session', 'SingletonCookie'),
        path.join(authPath, 'session', 'SingletonSocket'),
        path.join(authPath, 'session', 'Default', 'SingletonLock'),
        path.join(authPath, 'session', 'Default', 'SingletonCookie'),
        path.join(authPath, 'session', 'Default', 'SingletonSocket')
      ];
      for (const file of lockFiles) {
        try {
          if (fs.lstatSync(file)) {
            fs.unlinkSync(file);
            console.log(`Removed lock file: ${file}`);
          }
        } catch (err) {
          if (err.code !== 'ENOENT') {
            console.error(`Error checking/removing ${file}:`, err);
          }
        }
      }
    } catch (e) {
      console.error('Error cleaning up lock files:', e);
    }

    waClient = new Client({
      authStrategy: new LocalAuth({ dataPath: authPath }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      }
    });

    waClient.on('qr', async (qr) => {
      console.log('QR Code Received');
      waStatus = 'qr';
      waQrCode = await qrcode.toDataURL(qr);
      io.emit('wa_status', { status: waStatus, qr: waQrCode });
    });

    waClient.on('ready', async () => {
      console.log('WhatsApp Client is ready!');
      waStatus = 'connected';
      waQrCode = '';
      io.emit('wa_status', { status: waStatus });

      try {
        const result = await pool.query("SELECT id FROM chats");
        const rows = result.rows;
        for (const row of rows) {
          await syncChatProfilePic(row.id);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (err) {
        console.error('Error loading chats for profile pic sync:', err);
      }
    });

    waClient.on('authenticated', () => {
      console.log('WhatsApp Authenticated');
    });

    waClient.on('auth_failure', (msg) => {
      console.error('WhatsApp Auth Failure:', msg);
      waStatus = 'error';
      waError = msg;
      io.emit('wa_status', { status: waStatus, error: waError });
    });

    waClient.on('disconnected', (reason) => {
      console.log('WhatsApp Disconnected:', reason);
      waStatus = 'disconnected';
      io.emit('wa_status', { status: waStatus });
      
      setTimeout(initWhatsApp, 5000);
    });

    waClient.on('message_create', async (msg) => {
      if (msg.isStatus) return;
      
      const chat = await msg.getChat();
      if (chat.isGroup) return; // Ignore groups for now

      const chatId = chat.id._serialized;
      const contact = await chat.getContact();
      const name = contact.name || contact.pushname || contact.number;
      const phone = contact.number;
      let body = msg.body;
      const timestamp = msg.timestamp * 1000;
      const fromMe = msg.fromMe ? 1 : 0;

      let mediaUrl = null;
      let mediaType = null;
      let mediaName = null;
      let transcription = null;

      if (msg.hasMedia) {
        try {
          const media = await msg.downloadMedia();
          if (media) {
            const ext = media.mimetype.split('/')[1].split(';')[0];
            const filename = `${msg.id.id}.${ext}`;
            const filepath = path.join(MEDIA_DIR, filename);
            fs.writeFileSync(filepath, Buffer.from(media.data, 'base64'));
            
            mediaUrl = `/media/${filename}`;
            mediaType = media.mimetype;
            mediaName = media.filename || filename;

            if (media.mimetype.startsWith('audio/') && process.env.GEMINI_API_KEY) {
              try {
                const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
                const response = await ai.getGenerativeModel({ model: 'gemini-1.5-flash' }).generateContent({
                  contents: [
                    {
                      role: 'user',
                      parts: [
                        {
                          inlineData: {
                            data: media.data,
                            mimeType: media.mimetype,
                          },
                        },
                        { text: 'Transcreva este áudio em português. Retorne apenas a transcrição.' }
                      ],
                    },
                  ],
                });
                transcription = response.response.text();
              } catch (err) {
                console.error('Transcription error:', err);
              }
            }
          }
        } catch (err) {
          console.error('Error downloading media:', err);
        }
      }

      const displayBody = body || (mediaType ? `[Media: ${mediaType}]` : '');

      let profilePic = null;
      try {
        let profilePicUrl = await getProfilePicUrl(waClient, chatId);
        if (!profilePicUrl) {
          profilePicUrl = await waClient.getProfilePicUrl(chatId).catch(() => null);
        }

        if (profilePicUrl) {
          profilePic = await downloadProfilePic(profilePicUrl, chatId);
        }
      } catch (e) {
        console.log("Erro ao recuperar foto para:", chatId);
      }

      const resMsg = await pool.query("SELECT id FROM messages WHERE id = $1", [msg.id.id]);
      if (resMsg.rows.length > 0) return; // Message already processed

      const resChat = await pool.query("SELECT id, profile_pic FROM chats WHERE id = $1 OR (phone = $2 AND phone IS NOT NULL AND phone != '')", [chatId, phone]);
      const chatRow = resChat.rows[0];

      if (!chatRow) {
        // New chat
        const resCol = await pool.query("SELECT id FROM columns ORDER BY position ASC LIMIT 1");
        const colId = resCol.rows[0] ? resCol.rows[0].id : 'col-1';
        const unreadCount = fromMe ? 0 : 1;
        await pool.query("INSERT INTO chats (id, name, phone, column_id, last_message, last_message_time, unread_count, profile_pic, last_message_from_me) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
          [chatId, name, phone, colId, displayBody, timestamp, unreadCount, profilePic, fromMe]);
        
        io.emit('new_chat', { id: chatId, name, phone, column_id: colId, last_message: displayBody, last_message_time: timestamp, unread_count: unreadCount, profile_pic: profilePic, last_message_from_me: fromMe });
      } else {
        // Update existing
        const unreadUpdateClause = fromMe ? "" : "unread_count = unread_count + 1,";
        const finalProfilePic = profilePic || chatRow.profile_pic;
        
        if (chatRow.id !== chatId) {
          await pool.query("UPDATE chats SET id = $1 WHERE id = $2", [chatId, chatRow.id]);
          await pool.query("UPDATE messages SET chat_id = $1 WHERE chat_id = $2", [chatId, chatRow.id]);
          await pool.query("UPDATE chat_tags SET chat_id = $1 WHERE chat_id = $2", [chatId, chatRow.id]);
          io.emit('chat_deleted', { id: chatRow.id });
          
          const updatedChatRes = await pool.query("SELECT * FROM chats WHERE id = $1", [chatId]);
          if (updatedChatRes.rows[0]) {
            io.emit('new_chat', updatedChatRes.rows[0]);
          }
        }
        
        await pool.query(`UPDATE chats SET last_message = $1, last_message_time = $2, profile_pic = $3, name = $4, last_message_from_me = $5, ${unreadUpdateClause} id = id WHERE id = $6`,
          [displayBody, timestamp, finalProfilePic, name, fromMe, chatId]);
          
        io.emit('chat_updated', { id: chatId, last_message: displayBody, last_message_time: timestamp, profile_pic: finalProfilePic, name, last_message_from_me: fromMe });
      }

      await pool.query("INSERT INTO messages (id, chat_id, body, from_me, timestamp, media_url, media_type, media_name, transcription) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        [msg.id.id, chatId, body, fromMe, timestamp, mediaUrl, mediaType, mediaName, transcription]);

      io.emit('new_message', { id: msg.id.id, chat_id: chatId, body, from_me: fromMe, timestamp, media_url: mediaUrl, media_type: mediaType, media_name: mediaName, transcription });
      
      if (phone === '557591167094' && !fromMe && process.env.GEMINI_API_KEY) {
        try {
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
          
          const aiMemoryRes = await pool.query("SELECT * FROM ai_memory ORDER BY created_at DESC");
          const aiMemory = aiMemoryRes.rows || [];
          
          const systemInstruction = `Você é o assistente pessoal do usuário. Você está conversando com ele pelo WhatsApp.
Data e hora atual: ${new Date().toLocaleString('pt-BR')}

Sua memória atual (tarefas, lembretes, base de conhecimento):
${JSON.stringify(aiMemory)}

Se o usuário pedir para adicionar algo à sua memória, retorne APENAS o JSON:
{"command": "ADD_MEMORY", "params": {"content": "O que deve ser lembrado", "trigger_at": "2026-05-10T09:00:00"}} (trigger_at é opcional, use formato ISO 8601 se o usuário pedir para ser lembrado em uma data/hora específica)

Se o usuário pedir para enviar uma mensagem para alguém, retorne APENAS o JSON:
{"command": "SEND_MESSAGE", "params": {"phone": "5511999999999", "message": "Texto da mensagem"}}

Se o usuário pedir para agendar o envio de uma mensagem para alguém, retorne APENAS o JSON:
{"command": "SCHEDULE_MESSAGE", "params": {"phone": "5511999999999", "message": "Texto da mensagem", "trigger_at": "2026-05-10T09:00:00"}} (trigger_at é obrigatório e deve estar no formato ISO 8601)

Caso contrário, responda de forma natural, útil e prestativa.`;

          const response = await ai.getGenerativeModel({ model: 'gemini-1.5-flash' }).generateContent({
            contents: [{ role: 'user', parts: [{ text: body || transcription || 'Mensagem de mídia' }] }],
            systemInstruction: systemInstruction
          });

          let replyText = response.response.text() || '';
          
          try {
            const cleanJson = replyText.replace(/```json/g, '').replace(/```/g, '').trim();
            if (cleanJson.startsWith('{') && cleanJson.endsWith('}')) {
              const cmd = JSON.parse(cleanJson);
              if (cmd.command === 'ADD_MEMORY') {
                const triggerAtStr = cmd.params.trigger_at || cmd.params.data_alerta;
                let triggerAt = null;
                if (triggerAtStr) {
                  const parsedDate = new Date(triggerAtStr);
                  if (!isNaN(parsedDate.getTime())) {
                    triggerAt = parsedDate.getTime();
                  }
                }
                
                await pool.query("INSERT INTO ai_memory (content, created_at, trigger_at, is_triggered) VALUES ($1, $2, $3, $4)", [cmd.params.content, Date.now(), triggerAt, 0]);
                
                if (triggerAt) {
                  replyText = `✅ Lembrete agendado para ${new Date(triggerAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}:\n"${cmd.params.content}"`;
                } else {
                  replyText = `✅ Lembrete/Tarefa adicionada à minha memória:\n"${cmd.params.content}"`;
                }
              } else if (cmd.command === 'SEND_MESSAGE') {
                const phone = cmd.params.phone;
                const msgText = cmd.params.message;
                if (phone && msgText && waClient && waStatus === 'connected') {
                  const targetChatId = `${phone}@c.us`;
                  await waClient.sendMessage(targetChatId, msgText);
                  replyText = `✅ Mensagem enviada para ${phone}:\n"${msgText}"`;
                } else {
                  replyText = `❌ Erro ao enviar mensagem. Verifique se o telefone e a mensagem estão corretos.`;
                }
              } else if (cmd.command === 'SCHEDULE_MESSAGE') {
                const phone = cmd.params.phone;
                const msgText = cmd.params.message;
                const triggerAtStr = cmd.params.trigger_at;
                let triggerAt = null;
                if (triggerAtStr) {
                  const parsedDate = new Date(triggerAtStr);
                  if (!isNaN(parsedDate.getTime())) {
                    triggerAt = parsedDate.getTime();
                  }
                }
                
                if (triggerAt && phone && msgText) {
                  await pool.query("INSERT INTO scheduled_messages (phone, message, trigger_at, is_triggered, created_at) VALUES ($1, $2, $3, $4, $5)", [phone, msgText, triggerAt, 0, Date.now()]);
                  replyText = `✅ Mensagem agendada para ${new Date(triggerAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}:\nPara: ${phone}\n"${msgText}"`;
                } else {
                  replyText = `❌ Erro ao agendar mensagem. Verifique se o telefone, mensagem e data/hora estão corretos.`;
                }
              }
            }
          } catch (e) {
            // Not a JSON, just send the text
          }

          if (replyText) {
            await waClient.sendMessage(chatId, replyText);
          }
        } catch (err) {
          console.error('Error processing AI message for 557591167094:', err);
        }
      }
    });
    });

    waClient.initialize().catch(err => {
      console.error('Failed to initialize WhatsApp:', err);
      waStatus = 'error';
      waError = err.message;
      io.emit('wa_status', { status: waStatus, error: waError });
    });
  };

  // Start WhatsApp
  initWhatsApp();

  app.get('/api/wa/status', (req, res) => {
    res.json({ status: waStatus, qr: waQrCode, error: waError });
  });

  app.post('/api/wa/reset', async (req, res) => {
    if (waClient) {
      try {
        await waClient.destroy();
      } catch (e) {}
    }
    const authPath = path.join(DATA_DIR, 'wa_auth');
    if (fs.existsSync(authPath)) {
      fs.rmSync(authPath, { recursive: true, force: true });
    }
    initWhatsApp();
    res.json({ success: true });
  });

  app.post('/api/wa/restart', async (req, res) => {
    if (waClient) {
      try {
        await waClient.destroy();
      } catch (e) {}
    }
    initWhatsApp();
    res.json({ success: true });
  });

  // --- Vite Middleware for Development ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
