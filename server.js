import 'dotenv/config';
import express from 'express';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import QRCode from 'qrcode';
import fs from 'fs';
import sqlite3 from 'sqlite3';
import multer from 'multer';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import http from 'http';
import { Server } from 'socket.io';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

io.use((socket, next) => {
    const token = socket.handshake.query.token;
    if (!token) return next();
    const parts = token.split('-');
    if (parts.length >= 3) {
        const user = parts.slice(2).join('-');
        socket.user = user;
        socket.join(user);
    }
    next();
});

// Configuração de diretórios
const DATA_DIR = process.env.DATA_PATH || path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const LOG_FILE = path.join(DATA_DIR, 'debug_whatsapp.log');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// --- SYSTEM: Logger ---
const log = (message, error = null) => {
    const timestamp = new Date().toISOString();
    let errorDetail = '';
    
    if (error) {
        errorDetail = `\nERROR: ${error.message}`;
        if (error.stack) errorDetail += `\nSTACK: ${error.stack}`;
    }

    const logMessage = `[${timestamp}] ${message}${errorDetail}\n`;
    console.log(`[APP] ${message}`);
    if (error) console.error(error);

    try {
        fs.appendFileSync(LOG_FILE, logMessage);
    } catch (e) {
        console.error("Falha crítica ao escrever no arquivo de log:", e);
    }
};

log("Servidor iniciando...");
log(`Diretório de dados: ${DATA_DIR}`);

// --- CONFIGURAÇÃO DO EXPRESS ---
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Servir arquivos estáticos do frontend (pasta dist criada pelo Vite)
// Importante: Isso deve vir antes das rotas de API para garantir performance
app.use(express.static(path.join(__dirname, 'dist')));

// --- HELPER: Puppeteer Lock Cleaner ---
const cleanPuppeteerLocks = (dir) => {
    const locks = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
    if (fs.existsSync(dir)) {
        locks.forEach(lock => {
            const lockPath = path.join(dir, lock);
            if (fs.existsSync(lockPath)) {
                try {
                    fs.unlinkSync(lockPath);
                    log(`[Puppeteer Fix] Trava removida: ${lockPath}`);
                } catch (e) {}
            }
        });
        const defaultDir = path.join(dir, 'Default');
        if (fs.existsSync(defaultDir)) {
             locks.forEach(lock => {
                const lockPath = path.join(defaultDir, lock);
                if (fs.existsSync(lockPath)) {
                    try { fs.unlinkSync(lockPath); } catch (e) {}
                }
            });
        }
    }
};

// --- HELPER: Robust WhatsApp Send ---
const safeSendMessage = async (client, chatId, content, options = {}) => {
    log(`[WhatsApp] Tentando enviar mensagem para: ${chatId}`);
    try {
        if (!client) throw new Error("Client é null");

        const safeOptions = { 
            ...options, 
            sendSeen: false 
        };

        let finalChatId = chatId;
        
        if (!finalChatId.includes('@')) {
             if (/^\d+$/.test(finalChatId)) {
                 finalChatId = `${finalChatId}@c.us`;
             } else {
                 throw new Error("ChatId mal formatado: " + chatId);
             }
        }

        try {
            if (finalChatId.endsWith('@c.us')) {
                const numberPart = finalChatId.replace('@c.us', '').replace(/\D/g, '');
                const contactId = await client.getNumberId(numberPart);
                
                if (contactId && contactId._serialized) {
                    finalChatId = contactId._serialized;
                }
            }
        } catch (idErr) {
            log(`[WhatsApp] Erro não bloqueante ao resolver getNumberId: ${idErr.message}`);
        }

        try {
            const chat = await client.getChatById(finalChatId);
            const msg = await chat.sendMessage(content, safeOptions);
            return msg;
        } catch (chatError) {
            const msg = await client.sendMessage(finalChatId, content, safeOptions);
            return msg;
        }

    } catch (error) {
        log(`[WhatsApp] FALHA CRÍTICA NO ENVIO para ${chatId}`, error);
        throw error;
    }
};

// --- MULTI-TENANCY: Database Management ---
const dbInstances = {};

const getDb = (username) => {
    if (!username) return null;
    if (dbInstances[username]) return dbInstances[username];

    const userDbPath = path.join(DATA_DIR, `${username}.db`);
    const db = new sqlite3.Database(userDbPath);
    
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS companies (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, docNumber TEXT, type TEXT, email TEXT, whatsapp TEXT)`);
        db.run(`CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT, status TEXT, priority TEXT, color TEXT, dueDate TEXT, companyId INTEGER, recurrence TEXT, dayOfWeek TEXT, recurrenceDate TEXT, targetCompanyType TEXT, createdAt TEXT)`);
        db.run(`CREATE TABLE IF NOT EXISTS document_status (id INTEGER PRIMARY KEY AUTOINCREMENT, companyId INTEGER, category TEXT, competence TEXT, status TEXT, UNIQUE(companyId, category, competence))`);
        db.run(`CREATE TABLE IF NOT EXISTS sent_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, companyName TEXT, docName TEXT, category TEXT, sentAt TEXT, channels TEXT, status TEXT)`);
        db.run(`CREATE TABLE IF NOT EXISTS user_settings (id INTEGER PRIMARY KEY CHECK (id = 1), settings TEXT)`);
        db.run(`CREATE TABLE IF NOT EXISTS scheduled_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, message TEXT, nextRun TEXT, recurrence TEXT, active INTEGER, type TEXT, channels TEXT, targetType TEXT, selectedCompanyIds TEXT, attachmentFilename TEXT, attachmentOriginalName TEXT, documentsPayload TEXT, createdBy TEXT)`);
        
        // Tabelas para Kanban WhatsApp
        db.run(`CREATE TABLE IF NOT EXISTS columns (id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL, color TEXT DEFAULT '#e2e8f0')`);
        db.run(`CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, name TEXT, phone TEXT, column_id TEXT, last_message TEXT, last_message_time INTEGER, unread_count INTEGER DEFAULT 0, profile_pic TEXT, last_message_from_me INTEGER DEFAULT 0)`);
        db.run(`CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL)`);
        db.run(`CREATE TABLE IF NOT EXISTS chat_tags (chat_id TEXT, tag_id TEXT, PRIMARY KEY (chat_id, tag_id))`);
        db.run(`CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, body TEXT, from_me INTEGER, timestamp INTEGER, media_url TEXT, media_type TEXT, media_name TEXT, transcription TEXT)`);

        db.get("SELECT COUNT(*) as count FROM columns", (err, row) => {
            if (row && row.count === 0) {
                const stmt = db.prepare("INSERT INTO columns (id, name, position) VALUES (?, ?, ?)");
                stmt.run('col-1', 'Novos', 0);
                stmt.run('col-2', 'Em Atendimento', 1);
                stmt.run('col-3', 'Aguardando Cliente', 2);
                stmt.run('col-4', 'Finalizados', 3);
                stmt.finalize();
            }
        });

        db.all("PRAGMA table_info(scheduled_messages)", [], (err, rows) => {
            if (rows && !rows.some(col => col.name === 'documentsPayload')) {
                db.run("ALTER TABLE scheduled_messages ADD COLUMN documentsPayload TEXT", () => {});
            }
        });
        db.all("PRAGMA table_info(tasks)", [], (err, rows) => {
            if (rows && !rows.some(col => col.name === 'createdAt')) {
                const today = new Date().toISOString().split('T')[0];
                db.run("ALTER TABLE tasks ADD COLUMN createdAt TEXT", () => db.run("UPDATE tasks SET createdAt = ?", [today]));
            }
        });
    });

    dbInstances[username] = db;
    return db;
};

// --- EMAIL CONFIGURATION ---
const emailPort = parseInt(process.env.EMAIL_PORT || '465');
const emailTransporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: emailPort,
    secure: emailPort === 465,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

const pickOrCreateSentMailbox = async (imap) => {
    if (process.env.SENT_FOLDER) {
        log(`[IMAP] Usando pasta configurada: ${process.env.SENT_FOLDER}`);
        return process.env.SENT_FOLDER;
    }

    const candidates = [
        'Sent',
    ];

    const findMailbox = async () => {
        for await (const box of imap.list()) {
            if (candidates.includes(box.path) || candidates.includes(box.name)) {
                return box.path;
            }
        }
        return null;
    };

    let folder = await findMailbox();
    if (folder) return folder;

    for (const name of ['Sent', 'Enviados']) {
        try {
            await imap.mailboxCreate(name);
            folder = await findMailbox();
            if (folder) return folder;
        } catch (e) {
            // tenta o próximo nome
        }
    }

    return 'Sent';
};

const saveToImapSentFolder = async (mailOptions) => {
    let imap;
    try {
        const emailUser = process.env.EMAIL_USER;
        const emailPass = process.env.EMAIL_PASS;

        if (!emailUser || !emailPass) {
            log('[IMAP] EMAIL_USER e EMAIL_PASS não configurados. Ignorando IMAP.');
            return;
        }

        const imapHost = process.env.IMAP_HOST || 'imap.hostinger.com';
        const imapPort = parseInt(process.env.IMAP_PORT || '993');
        const imapSecure = process.env.IMAP_SECURE !== 'false';

        const mimePreview = nodemailer.createTransport({
            streamTransport: true,
            buffer: true,
            newline: 'unix',
        });

        const mime = await mimePreview.sendMail({
            ...mailOptions,
            from: mailOptions.from || emailUser,
            date: new Date(),
            text: mailOptions.text || ' ',
            html: mailOptions.html || '<p></p>',
        });

        imap = new ImapFlow({
            host: imapHost,
            port: imapPort,
            secure: imapSecure,
            auth: {
                user: emailUser,
                pass: emailPass,
            },
            tls: { rejectUnauthorized: false },
        });

        await imap.connect();

        const sentFolder = await pickOrCreateSentMailbox(imap);
        await imap.append(sentFolder, mime.message, {
            flags: ['\\Seen'],
            internalDate: new Date(),
        });

        log(`[IMAP] Email salvo na pasta ${sentFolder} com sucesso.`);
    } catch (err) {
        log(`[IMAP Error] ${err.message}`, err);
    } finally {
        if (imap) await imap.logout().catch(() => {});
    }
};

// --- MULTI-TENANCY: WhatsApp Management ---
const waClients = {}; 

const getWaClientWrapper = (username) => {
    if (!username) return null;
    
    if (!waClients[username]) {
        log(`[WhatsApp Init] Inicializando cliente para usuário: ${username}`);
        
        waClients[username] = {
            client: null,
            qr: null,
            status: 'disconnected',
            info: null
        };

        const authPath = path.join(DATA_DIR, `whatsapp_auth_${username}`);
        if (!fs.existsSync(authPath)) fs.mkdirSync(authPath, { recursive: true });

        const sessionPath = path.join(authPath, `session-${username}`);
        cleanPuppeteerLocks(sessionPath);

        const puppeteerExecutablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser';
        
        const client = new Client({
            authStrategy: new LocalAuth({ clientId: username, dataPath: authPath }), 
            puppeteer: {
                headless: true,
                executablePath: puppeteerExecutablePath,
                args: [
                    '--no-sandbox', 
                    '--disable-setuid-sandbox', 
                    '--disable-dev-shm-usage', 
                    '--disable-accelerated-2d-canvas', 
                    '--no-first-run', 
                    '--no-zygote', 
                    '--disable-gpu', 
                    '--disable-software-rasterizer',
                    '--single-process'
                ],
            }
        });

                // --- INTERCEPTADOR DE MENSAGENS (Kanban) ---
        client.on('message', async (msg) => {
            if (msg.isStatus) return;
            const chat = await msg.getChat();
            if (chat.isGroup) return; 

            const chatId = chat.id._serialized;
            const contact = await chat.getContact();
            const name = contact.name || contact.pushname || contact.number;
            const phone = contact.number;
            const body = msg.body;
            const timestamp = msg.timestamp * 1000;
            const fromMe = msg.fromMe ? 1 : 0;

            let mediaUrl = null;
            let mediaType = null;
            let mediaName = null;

            if (msg.hasMedia) {
                try {
                    const media = await msg.downloadMedia();
                    if (media) {
                        const ext = media.mimetype.split('/')[1].split(';')[0];
                        const filename = msg.id.id + '.' + ext;
                        const filepath = path.join(UPLOADS_DIR, filename);
                        fs.writeFileSync(filepath, Buffer.from(media.data, 'base64'));
                        mediaUrl = `/uploads/${filename}`;
                        mediaType = media.mimetype;
                        mediaName = media.filename || filename;
                    }
                } catch (e) {
                    log('Erro download media', e);
                }
            }

            const displayBody = body || (mediaType ? `[Media: ${mediaType}]` : '');
            let profilePic = null;
            
            try {
                profilePic = await client.getProfilePicUrl(chatId).catch(() => null);
            } catch (e) {}

            const db = getDb(username);

            db.get("SELECT id FROM messages WHERE id = ?", [msg.id.id], (err, row) => {
                if (row) return;

                db.get("SELECT id, profile_pic FROM chats WHERE id = ? OR (phone = ? AND phone IS NOT NULL AND phone != '')", [chatId, phone], (err, chatRow) => {
                    if (!chatRow) {
                        db.get("SELECT id FROM columns ORDER BY position ASC LIMIT 1", (err, colRow) => {
                            const colId = colRow ? colRow.id : 'col-1';
                            const unreadCount = fromMe ? 0 : 1;
                            db.run("INSERT INTO chats (id, name, phone, column_id, last_message, last_message_time, unread_count, profile_pic, last_message_from_me) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                [chatId, name, phone, colId, displayBody, timestamp, unreadCount, profilePic, fromMe], () => {
                                    io.to(username).emit('new_chat', { id: chatId, name, phone, column_id: colId, last_message: displayBody, last_message_time: timestamp, unread_count: unreadCount, profile_pic: profilePic, last_message_from_me: fromMe });
                                });
                        });
                    } else {
                        const unreadUpdate = fromMe ? "" : ", unread_count = unread_count + 1";
                        const finalProfilePic = profilePic || chatRow.profile_pic;
                        
                        db.serialize(() => {
                            if (chatRow.id !== chatId) {
                                db.run("UPDATE chats SET id = ? WHERE id = ?", [chatId, chatRow.id]);
                                db.run("UPDATE messages SET chat_id = ? WHERE chat_id = ?", [chatId, chatRow.id]);
                                db.run("UPDATE chat_tags SET chat_id = ? WHERE chat_id = ?", [chatId, chatRow.id]);
                            }
                            
                            db.run(`UPDATE chats SET last_message = ?, last_message_time = ?, profile_pic = ?, name = ?, last_message_from_me = ?${unreadUpdate} WHERE id = ?`,
                                [displayBody, timestamp, finalProfilePic, name, fromMe, chatId], () => {
                                    io.to(username).emit('chat_updated', { id: chatId, last_message: displayBody, last_message_time: timestamp, profile_pic: finalProfilePic, name, last_message_from_me: fromMe });
                                });
                        });
                    }
                });

                db.run("INSERT INTO messages (id, chat_id, body, from_me, timestamp, media_url, media_type, media_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    [msg.id.id, chatId, body, fromMe, timestamp, mediaUrl, mediaType, mediaName], () => {
                        io.to(username).emit('new_message', { id: msg.id.id, chat_id: chatId, body, from_me: fromMe, timestamp, media_url: mediaUrl, media_type: mediaType, media_name: mediaName });
                    });
            });
        });

        client.on('qr', (qr) => { 
            log(`[WhatsApp Event] QR Code gerado para ${username}`);
            QRCode.toDataURL(qr, (err, url) => { 
                if (err) log(`[WhatsApp Event] Erro QR`, err);
                waClients[username].qr = url; 
                waClients[username].status = 'generating_qr';
            }); 
        });
        
        client.on('ready', () => { 
            log(`[WhatsApp Event] CLIENTE PRONTO (${username})`);
            waClients[username].status = 'connected';
            waClients[username].qr = null;
            waClients[username].info = client.info;
        });
        
        client.on('authenticated', () => {
            log(`[WhatsApp Event] Autenticado (${username})`);
        });

        client.on('auth_failure', (msg) => {
            log(`[WhatsApp Event] FALHA DE AUTENTICAÇÃO (${username}): ${msg}`);
            waClients[username].status = 'error';
        });
        
        client.on('disconnected', (reason) => { 
            log(`[WhatsApp Event] Desconectado (${username}). Razão: ${reason}`);
            waClients[username].status = 'disconnected';
            waClients[username].info = null;
        });

        client.initialize().catch((err) => {
            log(`[WhatsApp Init] ERRO FATAL (${username})`, err);
            waClients[username].status = 'error';
        });
        
        waClients[username].client = client;
    }

    return waClients[username];
};

// --- LOGIC: Send Daily Summary Helper ---
const sendDailySummaryToUser = async (user) => {
    const db = getDb(user);
    if (!db) return;

    const waWrapper = getWaClientWrapper(user);
    if (waWrapper.status !== 'connected') {
        return { success: false, message: 'WhatsApp desconectado' };
    }

    return new Promise((resolve, reject) => {
        db.get("SELECT settings FROM user_settings WHERE id = 1", (e, r) => {
            if (e || !r) { resolve({ success: false, message: 'Configurações não encontradas' }); return; }
            
            const settings = JSON.parse(r.settings);
            if (!settings.dailySummaryNumber) { resolve({ success: false, message: 'Número para resumo não configurado' }); return; }

            const sql = `SELECT t.*, c.name as companyName FROM tasks t LEFT JOIN companies c ON t.companyId = c.id WHERE t.status != 'concluida'`;

            db.all(sql, [], async (err, tasks) => {
                if (err) { resolve({ success: false, message: 'Erro ao buscar tarefas' }); return; }
                if (!tasks || tasks.length === 0) { resolve({ success: true, message: 'Nenhuma tarefa pendente' }); return; }

                const priorityMap = { 'alta': 1, 'media': 2, 'baixa': 3 };
                const sortedTasks = tasks.sort((a, b) => (priorityMap[a.priority] || 99) - (priorityMap[b.priority] || 99));

                let message = `*📅 Resumo Diário de Tarefas*\n\nVocê tem *${sortedTasks.length}* tarefas pendentes.\n\n`;
                sortedTasks.forEach(task => {
                    let icon = task.priority === 'alta' ? '🔴' : task.priority === 'media' ? '🟡' : '🔵';
                    message += `${icon} *${task.title}*\n`;
                    if (task.companyName) message += `   🏢 ${task.companyName}\n`;
                    if (task.dueDate) message += `   📅 Vence: ${task.dueDate}\n`;
                    message += `\n`;
                });
                message += `_Gerado automaticamente pelo Contábil Manager Pro_`;

                try {
                    let number = settings.dailySummaryNumber.replace(/\D/g, '');
                    if (!number.startsWith('55')) number = '55' + number;
                    const chatId = `${number}@c.us`;
                    
                    await safeSendMessage(waWrapper.client, chatId, message);
                    resolve({ success: true, message: 'Enviado com sucesso' });
                } catch (sendErr) {
                    log(`[Summary] Erro envio`, sendErr);
                    resolve({ success: false, message: 'Erro no envio do WhatsApp' });
                }
            });
        });
    });
};

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; 
    if (!token) return res.status(401).json({ error: 'Token não fornecido' });
    const parts = token.split('-');
    if (parts.length < 3) return res.status(403).json({ error: 'Token inválido' });
    const user = parts.slice(2).join('-'); 
    const envUsers = (process.env.USERS || '').split(',');
    if (!envUsers.includes(user)) return res.status(403).json({ error: 'Usuário não autorizado' });
    req.user = user;
    next();
};

const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, UPLOADS_DIR) },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
    cb(null, uniqueSuffix + '-' + cleanName)
  }
})
const upload = multer({ storage: storage });

// --- HTML Builder Helper ---
const buildEmailHtml = (messageBody, documents, emailSignature) => {
    let docsTable = '';
    if (documents && documents.length > 0) {
        const sortedDocs = [...documents].sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
        let rows = '';
        sortedDocs.forEach(doc => {
            rows += `<tr style="border-bottom: 1px solid #eee;"><td style="padding: 10px; color: #333;">${doc.docName}</td><td style="padding: 10px; color: #555;">${doc.category}</td><td style="padding: 10px; color: #555;">${doc.dueDate || 'N/A'}</td><td style="padding: 10px; color: #555;">${doc.competence}</td></tr>`;
        });
        docsTable = `<h3 style="color: #2c3e50; border-bottom: 2px solid #eff6ff; padding-bottom: 10px; margin-top: 30px; font-size: 16px;">Documentos em Anexo:</h3><table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;"><thead><tr style="background-color: #f8fafc; color: #64748b;"><th style="padding: 10px; text-align: left; border-bottom: 2px solid #e2e8f0;">Documento</th><th style="padding: 10px; text-align: left; border-bottom: 2px solid #e2e8f0;">Categoria</th><th style="padding: 10px; text-align: left; border-bottom: 2px solid #e2e8f0;">Vencimento</th><th style="padding: 10px; text-align: left; border-bottom: 2px solid #e2e8f0;">Competência</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
    return `<html><body style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f4; margin: 0; padding: 20px;"><div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);"><div style="background-color: #f8f9fa; padding: 20px; border-radius: 6px; border-left: 4px solid #2563eb; margin-bottom: 25px;">${messageBody.replace(/\n/g, '<br>')}</div>${docsTable}<div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 14px; color: #64748b;">${emailSignature || ''}</div></div></body></html>`;
};

// --- ROUTES ---

app.post('/api/login', (req, res) => {
    const { user, password } = req.body;
    const envUsers = (process.env.USERS || 'admin').split(',');
    const envPasss = (process.env.PASSWORDS || 'admin').split(',');
    const userIndex = envUsers.indexOf(user);

    if (userIndex !== -1 && envPasss[userIndex] === password) {
        getWaClientWrapper(user);
        res.json({ success: true, token: `session-${Date.now()}-${user}` });
    } else {
        res.status(401).json({ error: 'Credenciais inválidas' });
    }
});

app.use('/api', authenticateToken);

app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo' });
    res.json({ filename: req.file.filename, originalName: req.file.originalname });
});

app.get('/api/settings', (req, res) => {
    const db = getDb(req.user);
    if (!db) return res.status(500).json({ error: 'Database error' });
    db.get("SELECT settings FROM user_settings WHERE id = 1", (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row ? JSON.parse(row.settings) : null);
    });
});

app.post('/api/settings', (req, res) => {
    const db = getDb(req.user);
    if (!db) return res.status(500).json({ error: 'Database error' });
    const settingsJson = JSON.stringify(req.body);
    db.run("INSERT INTO user_settings (id, settings) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET settings=excluded.settings", [settingsJson], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.post('/api/trigger-daily-summary', async (req, res) => {
    try {
        const result = await sendDailySummaryToUser(req.user);
        if (result && result.success) {
            res.json({ success: true });
        } else {
            res.status(400).json({ error: result ? result.message : "Falha desconhecida" });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/companies', (req, res) => { 
    const db = getDb(req.user);
    if (!db) return res.status(500).json({ error: 'Database error' });
    db.all('SELECT * FROM companies ORDER BY name ASC', (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    }); 
});

app.post('/api/companies', (req, res) => {
    const { id, name, docNumber, type, email, whatsapp } = req.body;
    const db = getDb(req.user);
    if (!db) return res.status(500).json({ error: 'Database error' });

    if (id) {
        db.run(`UPDATE companies SET name=?, docNumber=?, type=?, email=?, whatsapp=? WHERE id=?`, 
            [name, docNumber, type, email, whatsapp, id], 
            function(err) { 
                if (err) return res.status(500).json({ error: err.message });
                res.json({success: true, id});
            });
    } else {
        db.run(`INSERT INTO companies (name, docNumber, type, email, whatsapp) VALUES (?, ?, ?, ?, ?)`, 
            [name, docNumber, type, email, whatsapp], 
            function(err) { 
                if (err) return res.status(500).json({ error: err.message });
                res.json({success: true, id: this.lastID});
            });
    }
});

app.delete('/api/companies/:id', (req, res) => { 
    const db = getDb(req.user);
    if (!db) return res.status(500).json({ error: 'Database error' });
    db.run('DELETE FROM companies WHERE id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.get('/api/tasks', (req, res) => {
    getDb(req.user).all('SELECT * FROM tasks', (err, rows) => res.json(rows || []));
});
app.post('/api/tasks', (req, res) => {
    const t = req.body;
    const db = getDb(req.user);
    const today = new Date().toISOString().split('T')[0];
    const createdAt = t.createdAt || today;

    if (t.id && t.id < 1000000000000) {
        // Update
        db.run(`UPDATE tasks SET title=?, description=?, status=?, priority=?, color=?, dueDate=?, companyId=?, recurrence=?, dayOfWeek=?, recurrenceDate=?, targetCompanyType=?, createdAt=? WHERE id=?`, 
        [t.title, t.description, t.status, t.priority, t.color, t.dueDate, t.companyId, t.recurrence, t.dayOfWeek, t.recurrenceDate, t.targetCompanyType, createdAt, t.id], 
        function(err) { res.json({ success: !err, id: t.id }); });
    } else {
        // Insert
        db.run(`INSERT INTO tasks (title, description, status, priority, color, dueDate, companyId, recurrence, dayOfWeek, recurrenceDate, targetCompanyType, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
        [t.title, t.description, t.status, t.priority, t.color, t.dueDate, t.companyId, t.recurrence, t.dayOfWeek, t.recurrenceDate, t.targetCompanyType, createdAt], 
        function(err) { res.json({ success: !err, id: this.lastID }); });
    }
});
app.delete('/api/tasks/:id', (req, res) => { getDb(req.user).run('DELETE FROM tasks WHERE id = ?', [req.params.id], (err) => res.json({ success: !err })); });

app.get('/api/documents/status', (req, res) => {
    const sql = req.query.competence ? 'SELECT * FROM document_status WHERE competence = ?' : 'SELECT * FROM document_status';
    getDb(req.user).all(sql, req.query.competence ? [req.query.competence] : [], (err, rows) => res.json(rows || []));
});
app.post('/api/documents/status', (req, res) => {
    const { companyId, category, competence, status } = req.body;
    getDb(req.user).run(`INSERT INTO document_status (companyId, category, competence, status) VALUES (?, ?, ?, ?) ON CONFLICT(companyId, category, competence) DO UPDATE SET status = excluded.status`, [companyId, category, competence, status], (err) => res.json({ success: !err }));
});

// --- Scheduled Messages Routes ---
app.get('/api/scheduled', (req, res) => {
    getDb(req.user).all("SELECT * FROM scheduled_messages", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows.map(row => ({
            ...row, 
            active: !!row.active, 
            channels: JSON.parse(row.channels || '{}'),
            selectedCompanyIds: row.selectedCompanyIds ? JSON.parse(row.selectedCompanyIds) : [],
            documentsPayload: row.documentsPayload || null
        })) || []);
    });
});

app.post('/api/scheduled', (req, res) => {
    const { id, title, message, nextRun, recurrence, active, type, channels, targetType, selectedCompanyIds, attachmentFilename, attachmentOriginalName, documentsPayload } = req.body;
    const db = getDb(req.user);
    const channelsStr = JSON.stringify(channels);
    const companyIdsStr = JSON.stringify(selectedCompanyIds || []);

    if (id) {
        db.run(`UPDATE scheduled_messages SET title=?, message=?, nextRun=?, recurrence=?, active=?, type=?, channels=?, targetType=?, selectedCompanyIds=?, attachmentFilename=?, attachmentOriginalName=?, documentsPayload=? WHERE id=?`,
        [title, message, nextRun, recurrence, active ? 1 : 0, type, channelsStr, targetType, companyIdsStr, attachmentFilename, attachmentOriginalName, documentsPayload, id],
        function(err) { if (err) return res.status(500).json({error: err.message}); res.json({success: true, id}); });
    } else {
        db.run(`INSERT INTO scheduled_messages (title, message, nextRun, recurrence, active, type, channels, targetType, selectedCompanyIds, attachmentFilename, attachmentOriginalName, documentsPayload, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [title, message, nextRun, recurrence, active ? 1 : 0, type, channelsStr, targetType, companyIdsStr, attachmentFilename, attachmentOriginalName, documentsPayload, req.user],
        function(err) { if (err) return res.status(500).json({error: err.message}); res.json({success: true, id: this.lastID}); });
    }
});

app.delete('/api/scheduled/:id', (req, res) => {
    getDb(req.user).run('DELETE FROM scheduled_messages WHERE id = ?', [req.params.id], (err) => res.json({ success: !err }));
});

app.get('/api/whatsapp/status', (req, res) => { 
    const wrapper = getWaClientWrapper(req.user);
    res.json({ 
        status: wrapper.status, 
        qr: wrapper.qr, 
        info: wrapper.info 
    }); 
});
app.post('/api/whatsapp/disconnect', async (req, res) => { 
    try { 
        const wrapper = getWaClientWrapper(req.user);
        if (wrapper.client) {
            await wrapper.client.logout(); 
            wrapper.status = 'disconnected';
            wrapper.qr = null;
        }
        res.json({ success: true }); 
    } catch (e) { res.status(500).json({ error: e.message }); } 
});

// --- NEW ROUTE: HARD RESET ---
app.post('/api/whatsapp/reset', async (req, res) => {
    try {
        const username = req.user;
        log(`[WhatsApp Reset] Solicitado reset forçado para: ${username}`);
        
        // 1. Destruir cliente atual se existir
        if (waClients[username] && waClients[username].client) {
            try {
                await waClients[username].client.destroy();
                log(`[WhatsApp Reset] Cliente destruído.`);
            } catch (e) {
                log(`[WhatsApp Reset] Erro ao destruir cliente (ignorado): ${e.message}`);
            }
            delete waClients[username];
        }

        // 2. Apagar pasta de autenticação
        const authPath = path.join(DATA_DIR, `whatsapp_auth_${username}`);
        if (fs.existsSync(authPath)) {
            try {
                fs.rmSync(authPath, { recursive: true, force: true });
                log(`[WhatsApp Reset] Pasta de autenticação removida: ${authPath}`);
            } catch (e) {
                log(`[WhatsApp Reset] Erro ao remover pasta: ${e.message}`);
                return res.status(500).json({ error: "Falha ao limpar arquivos de sessão. Tente reiniciar o servidor." });
            }
        }

        // 3. Reiniciar wrapper (vai gerar novo QR Code na próxima chamada de status)
        getWaClientWrapper(username);

        res.json({ success: true, message: "Sessão resetada. Aguarde o novo QR Code." });

    } catch (e) {
        log(`[WhatsApp Reset] Erro fatal: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
});


app.post('/api/send-documents', async (req, res) => {
    const { documents, subject, messageBody, channels, emailSignature, whatsappTemplate } = req.body;
    
    log(`[API send-documents] Iniciando envio de ${documents.length} documentos. Channels: ${JSON.stringify(channels)}`);
    
    const db = getDb(req.user);
    const waWrapper = getWaClientWrapper(req.user);
    const client = waWrapper.client;
    const clientReady = waWrapper.status === 'connected';

    if (channels.whatsapp && !clientReady) {
        log(`[API send-documents] AVISO: Tentativa de envio via WhatsApp, mas cliente não está conectado.`);
    }

    let successCount = 0;
    let errors = [];
    let sentIds = [];

    const docsByCompany = documents.reduce((acc, doc) => {
        if (!acc[doc.companyId]) acc[doc.companyId] = [];
        acc[doc.companyId].push(doc);
        return acc;
    }, {});

    const companyIds = Object.keys(docsByCompany);

    for (const companyId of companyIds) {
        const companyDocs = docsByCompany[companyId];
        
        try {
            const company = await new Promise((resolve, reject) => {
                db.get("SELECT * FROM companies WHERE id = ?", [companyId], (err, row) => {
                    if (err) reject(err); else resolve(row);
                });
            });

            if (!company) { errors.push(`Empresa ID ${companyId} não encontrada.`); continue; }

            const sortedDocs = [...companyDocs].sort((a, b) => {
                const dateA = a.dueDate ? a.dueDate.split('/').reverse().join('') : '99999999';
                const dateB = b.dueDate ? b.dueDate.split('/').reverse().join('') : '99999999';
                return dateA.localeCompare(dateB);
            });

            const validAttachments = [];
            for (const doc of sortedDocs) {
                if (doc.serverFilename) {
                    const filePath = path.join(UPLOADS_DIR, doc.serverFilename);
                    if (fs.existsSync(filePath)) {
                        validAttachments.push({
                            filename: doc.docName,
                            path: filePath,
                            contentType: 'application/pdf',
                            docData: doc
                        });
                    } else {
                        log(`[API send-documents] Arquivo físico não encontrado: ${filePath}`);
                        errors.push(`Arquivo sumiu do servidor: ${doc.docName}`);
                    }
                }
            }

            if (channels.email && company.email) {
                try {
                    const finalHtml = buildEmailHtml(messageBody, companyDocs, emailSignature);
                    const finalSubject = `${subject} - Competência: ${companyDocs[0].competence || 'N/A'}`; 
                    
                    const emailList = company.email.split(',').map(e => e.trim()).filter(e => e);
                    const mainEmail = emailList[0];
                    const ccEmails = emailList.slice(1).join(', ');

                    if (mainEmail) {
                        const senderName = process.env.EMAIL_FROM_NAME || 'Contabilidade';
                        const senderEmail = process.env.EMAIL_FROM_EMAIL || process.env.EMAIL_USER;
                        const fromAddress = `"${senderName}" <${senderEmail}>`;

                        const mailOptions = {
                            from: fromAddress,
                            to: mainEmail,
                            cc: ccEmails, 
                            subject: finalSubject,
                            html: finalHtml,
                            attachments: validAttachments.map(a => ({ filename: a.filename, path: a.path, contentType: a.contentType }))
                        };
                        await emailTransporter.sendMail(mailOptions);
                        await saveToImapSentFolder(mailOptions).catch(err => 
                            log('[Email] Falha ao salvar no IMAP', err)
                        );
                        log(`[Email] Enviado para ${company.name} (${mainEmail})`);
                    }
                } catch (e) { 
                    log(`[Email] Erro envio ${company.name}`, e);
                    errors.push(`Erro Email ${company.name}: ${e.message}`); 
                }
            }

            if (channels.whatsapp && company.whatsapp && clientReady) {
                try {
                    let number = company.whatsapp.replace(/\D/g, '');
                    if (!number.startsWith('55')) number = '55' + number;
                    const chatId = `${number}@c.us`;

                    const listaArquivos = validAttachments.map(att => 
                        `• ${att.docData.docName} (${att.docData.category || 'Anexo'}, Venc: ${att.docData.dueDate || 'N/A'})`
                    ).join('\n');
                    
                    const whatsappSignature = whatsappTemplate || "_Esses arquivos também foram enviados por e-mail_\n\nAtenciosamente,\nContabilidade";
                    let mensagemCompleta = `*📄 Olá!* \n\n${messageBody}`;
                    
                    if (listaArquivos) {
                        mensagemCompleta += `\n\n*Arquivos enviados:*\n${listaArquivos}`;
                    }
                    
                    mensagemCompleta += `\n\n${whatsappSignature}`;

                    // --- USANDO O HELPER SEGURO ---
                    await safeSendMessage(client, chatId, mensagemCompleta);
                    
                    for (const att of validAttachments) {
                        try {
                            const fileData = fs.readFileSync(att.path).toString('base64');
                            const media = new MessageMedia(att.contentType, fileData, att.filename);
                            
                            await safeSendMessage(client, chatId, media);
                            
                            // Delay para evitar flood
                            await new Promise(r => setTimeout(r, 3000));
                        } catch (mediaErr) {
                            log(`[WhatsApp] Erro envio mídia ${att.filename}`, mediaErr);
                            errors.push(`Erro mídia WhatsApp (${att.filename}): ${mediaErr.message}`);
                        }
                    }
                } catch (e) { 
                    log(`[WhatsApp] Erro envio ${company.name}`, e);
                    errors.push(`Erro Zap ${company.name}: ${e.message}`); 
                }
            } else if (channels.whatsapp && !clientReady) {
                 errors.push(`WhatsApp não conectado. Não foi possível enviar para ${company.name}`);
            }

            for (const doc of companyDocs) {
                if (doc.category) { 
                    db.run(`INSERT INTO sent_logs (companyName, docName, category, sentAt, channels, status) VALUES (?, ?, ?, datetime('now', 'localtime'), ?, 'success')`, 
                        [company.name, doc.docName, doc.category, JSON.stringify(channels)]);
                    
                    db.run(`INSERT INTO document_status (companyId, category, competence, status) VALUES (?, ?, ?, 'sent') ON CONFLICT(companyId, category, competence) DO UPDATE SET status='sent'`, 
                        [doc.companyId, doc.category, doc.competence]);
                }
                if (doc.id) sentIds.push(doc.id);
                successCount++;
            }
        } catch (e) { 
            log(`[API send-documents] Falha geral empresa ${companyId}`, e);
            errors.push(`Falha geral empresa ${companyId}: ${e.message}`); 
        }
    }
    
    res.json({ success: true, sent: successCount, sentIds, errors });
});

app.get('/api/recent-sends', (req, res) => {
    getDb(req.user).all("SELECT * FROM sent_logs ORDER BY id DESC LIMIT 3", (err, rows) => res.json(rows || []));
});

// --- KANBAN API ROUTES ---
app.get('/api/columns', (req, res) => {
    getDb(req.user).all("SELECT * FROM columns ORDER BY position ASC", (err, rows) => res.json(rows || []));
});
app.post('/api/columns', (req, res) => {
    const { id, name, position, color } = req.body;
    getDb(req.user).run("INSERT INTO columns (id, name, position, color) VALUES (?, ?, ?, ?)", [id, name, position, color || '#e2e8f0'], (err) => {
      io.to(req.user).emit('columns_updated');
      res.json({ success: true });
    });
});
app.put('/api/columns/:id', (req, res) => {
    const { name, position, color } = req.body;
    getDb(req.user).run("UPDATE columns SET name = ?, position = ?, color = ? WHERE id = ?", [name, position, color || '#e2e8f0', req.params.id], (err) => {
      io.to(req.user).emit('columns_updated');
      res.json({ success: true });
    });
});
app.delete('/api/columns/:id', (req, res) => {
    const db = getDb(req.user);
    const colId = req.params.id;
    db.get("SELECT id FROM columns WHERE id != ? ORDER BY position ASC LIMIT 1", [colId], (err, row) => {
      if (row) {
        db.run("UPDATE chats SET column_id = ? WHERE column_id = ?", [row.id, colId], () => {
          db.run("DELETE FROM columns WHERE id = ?", [colId], () => {
            io.to(req.user).emit('columns_updated');
            io.to(req.user).emit('chat_updated');
            res.json({ success: true });
          });
        });
      } else {
        res.status(400).json({ error: 'Cannot delete the last column' });
      }
    });
});
app.get('/api/chats', (req, res) => {
    getDb(req.user).all(`SELECT c.*, GROUP_CONCAT(t.id) as tag_ids FROM chats c LEFT JOIN chat_tags ct ON c.id = ct.chat_id LEFT JOIN tags t ON ct.tag_id = t.id GROUP BY c.id ORDER BY c.last_message_time DESC`, (err, rows) => {
      res.json((rows||[]).map(r => ({ ...r, tag_ids: r.tag_ids ? r.tag_ids.split(',') : [] })));
    });
});
app.put('/api/chats/:id/column', (req, res) => {
    getDb(req.user).run("UPDATE chats SET column_id = ? WHERE id = ?", [req.body.column_id, req.params.id], () => {
      io.to(req.user).emit('chat_updated', { id: req.params.id, column_id: req.body.column_id });
      res.json({ success: true });
    });
});
app.put('/api/chats/:id/name', (req, res) => {
    getDb(req.user).run("UPDATE chats SET name = ? WHERE id = ?", [req.body.name, req.params.id], () => {
      io.to(req.user).emit('chat_updated', { id: req.params.id, name: req.body.name });
      res.json({ success: true });
    });
});
app.put('/api/chats/:id/read', (req, res) => {
    getDb(req.user).run("UPDATE chats SET unread_count = 0 WHERE id = ?", [req.params.id], () => {
      io.to(req.user).emit('chat_updated', { id: req.params.id, unread_count: 0 });
      res.json({ success: true });
    });
});
app.get('/api/tags', (req, res) => {
    getDb(req.user).all("SELECT * FROM tags", (err, rows) => res.json(rows || []));
});
app.post('/api/tags', (req, res) => {
    getDb(req.user).run("INSERT INTO tags (id, name, color) VALUES (?, ?, ?)", [req.body.id, req.body.name, req.body.color], () => {
      io.to(req.user).emit('tags_updated');
      res.json({ success: true });
    });
});
app.put('/api/tags/:id', (req, res) => {
    getDb(req.user).run("UPDATE tags SET name = ?, color = ? WHERE id = ?", [req.body.name, req.body.color, req.params.id], () => {
      io.to(req.user).emit('tags_updated');
      res.json({ success: true });
    });
});
app.delete('/api/tags/:id', (req, res) => {
    const db = getDb(req.user);
    db.run("DELETE FROM chat_tags WHERE tag_id = ?", [req.params.id], () => {
      db.run("DELETE FROM tags WHERE id = ?", [req.params.id], () => {
        io.to(req.user).emit('tags_updated');
        res.json({ success: true });
      });
    });
});
app.post('/api/chats/:id/tags', (req, res) => {
    getDb(req.user).run("INSERT INTO chat_tags (chat_id, tag_id) VALUES (?, ?)", [req.params.id, req.body.tag_id], () => {
      io.to(req.user).emit('chat_tags_updated');
      res.json({ success: true });
    });
});
app.delete('/api/chats/:id/tags/:tag_id', (req, res) => {
    getDb(req.user).run("DELETE FROM chat_tags WHERE chat_id = ? AND tag_id = ?", [req.params.id, req.params.tag_id], () => {
      io.to(req.user).emit('chat_tags_updated');
      res.json({ success: true });
    });
});
app.get('/api/chats/:id/messages', (req, res) => {
    getDb(req.user).all("SELECT * FROM messages WHERE chat_id = ? ORDER BY timestamp ASC", [req.params.id], (err, rows) => {
      res.json(rows || []);
    });
});
app.post('/api/chats/:id/messages', upload.single('media'), async (req, res) => {
    const { body } = req.body;
    const chatId = req.params.id;
    const file = req.file;
    const waWrapper = getWaClientWrapper(req.user);
    const client = waWrapper.client;

    if (!client || waWrapper.status !== 'connected') {
        return res.status(500).json({ error: 'WhatsApp not connected' });
    }

    try {
        let sentMsg;
        let mediaUrl = null;
        let mediaType = null;
        let mediaName = null;

        if (file) {
            const fileData = fs.readFileSync(file.path).toString('base64');
            const media = new (require('whatsapp-web.js').MessageMedia)(file.mimetype, fileData, file.originalname);
            sentMsg = await safeSendMessage(client, chatId, media, { caption: body });
            mediaUrl = `/uploads/${file.filename}`;
            mediaType = file.mimetype;
            mediaName = file.originalname;
        } else {
            sentMsg = await safeSendMessage(client, chatId, body);
        }

        const msgId = sentMsg.id.id;
        const timestamp = Date.now();
        const db = getDb(req.user);

        db.run("INSERT INTO messages (id, chat_id, body, from_me, timestamp, media_url, media_type, media_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [msgId, chatId, body || '', 1, timestamp, mediaUrl, mediaType, mediaName]);
          
        db.run("UPDATE chats SET last_message = ?, last_message_time = ?, last_message_from_me = 1 WHERE id = ?",
            [body || 'Media', timestamp, chatId]);
          
        io.to(req.user).emit('new_message', {
            id: msgId, chat_id: chatId, body: body || '', from_me: 1, timestamp, media_url: mediaUrl, media_type: mediaType, media_name: mediaName
        });

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.delete('/api/chats/:id', (req, res) => {
    const db = getDb(req.user);
    db.run("DELETE FROM messages WHERE chat_id = ?", [req.params.id], () => {
      db.run("DELETE FROM chat_tags WHERE chat_id = ?", [req.params.id], () => {
        db.run("DELETE FROM chats WHERE id = ?", [req.params.id], () => {
          io.to(req.user).emit('chat_deleted', { id: req.params.id });
          res.json({ success: true });
        });
      });
    });
});
app.get('/api/media', (req, res) => {
    getDb(req.user).all(
      `SELECT m.id, m.chat_id, m.media_url, m.media_type, m.media_name, m.timestamp, m.from_me, c.name as chat_name, c.phone as chat_phone FROM messages m JOIN chats c ON m.chat_id = c.id WHERE m.media_url IS NOT NULL ORDER BY m.timestamp DESC`,
      (err, rows) => res.json(rows || [])
    );
});
app.delete('/api/media/:id', (req, res) => {
    const db = getDb(req.user);
    db.get("SELECT media_url FROM messages WHERE id = ?", [req.params.id], (err, row) => {
      if (row && row.media_url) {
        const p = path.join(__dirname, 'data', row.media_url);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
      db.run("UPDATE messages SET media_url = NULL, media_type = NULL, media_name = NULL WHERE id = ?", [req.params.id], () => {
        res.json({ success: true });
      });
    });
});

// --- Rota Catch-All para servir o React corretamente ---
app.get(/.*/, (req, res) => {
    if (!req.path.startsWith('/api')) res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// --- CRON JOB (Atualizado para Lembretes Pessoais) ---
setInterval(() => {
    const envUsers = (process.env.USERS || '').split(',');
    envUsers.forEach(user => {
        const db = getDb(user);
        if (!db) return;

        const now = new Date();
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        const brazilTime = new Date(utc - (3600000 * 3)); 
        const nowStr = brazilTime.toISOString().slice(0, 16); 

        db.all("SELECT * FROM scheduled_messages WHERE active = 1 AND nextRun <= ?", [nowStr], async (err, rows) => {
            if (err || !rows || rows.length === 0) return;

            log(`[CRON ${user}] Executando ${rows.length} tarefas. Hora: ${nowStr}`);
            
            const waWrapper = getWaClientWrapper(user);
            const clientReady = waWrapper.status === 'connected';

            const settings = await new Promise(resolve => {
                db.get("SELECT settings FROM user_settings WHERE id = 1", (e, r) => resolve(r ? JSON.parse(r.settings) : null));
            });

            for (const msg of rows) {
                try {
                    // --- CASO 1: LEMBRETE PESSOAL (Novo) ---
                    if (msg.targetType === 'personal') {
                        if (clientReady && settings?.dailySummaryNumber) {
                            let number = settings.dailySummaryNumber.replace(/\D/g, '');
                            if (!number.startsWith('55')) number = '55' + number;
                            const chatId = `${number}@c.us`;
                            
                            await safeSendMessage(waWrapper.client, chatId, `⏰ *Lembrete:* ${msg.message}`);
                            log(`[CRON] Lembrete pessoal enviado para ${user}`);
                        }
                    } 
                    // --- CASO 2: MENSAGEM PARA EMPRESAS (Existente) ---
                    else {
                        const channels = JSON.parse(msg.channels || '{}');
                        const selectedIds = JSON.parse(msg.selectedCompanyIds || '[]');
                        
                        let targetCompanies = [];
                        if (msg.targetType === 'selected' && selectedIds.length > 0) {
                            const placeholders = selectedIds.map(() => '?').join(',');
                            targetCompanies = await new Promise(resolve => db.all(`SELECT * FROM companies WHERE id IN (${placeholders})`, selectedIds, (e, r) => resolve(r || [])));
                        } else if (msg.targetType !== 'selected') {
                            const operator = msg.targetType === 'mei' ? '=' : '!=';
                            targetCompanies = await new Promise(resolve => db.all(`SELECT * FROM companies WHERE type ${operator} 'MEI'`, (e, r) => resolve(r || [])));
                        }
                        
                        let specificDocs = [];
                        if (msg.documentsPayload) {
                            try { specificDocs = JSON.parse(msg.documentsPayload); } catch(e) { log('[CRON] Erro parse docs payload', e); }
                        }

                        for (const company of targetCompanies) {
                            let attachmentsToSend = [];
                            let companySpecificDocs = [];

                            if (specificDocs.length > 0) {
                                companySpecificDocs = specificDocs.filter(d => d.companyId === company.id);
                                if (companySpecificDocs.length === 0) continue;
                                
                                for (const doc of companySpecificDocs) {
                                     if (doc.serverFilename) {
                                         const p = path.join(UPLOADS_DIR, doc.serverFilename);
                                         if (fs.existsSync(p)) {
                                             attachmentsToSend.push({ filename: doc.docName, path: p, contentType: 'application/pdf', docData: doc });
                                         }
                                     }
                                }
                            } else if (msg.attachmentFilename) {
                                const p = path.join(UPLOADS_DIR, msg.attachmentFilename);
                                if (fs.existsSync(p)) {
                                    attachmentsToSend.push({ filename: msg.attachmentOriginalName, path: p, contentType: 'application/pdf' });
                                }
                            }

                            if (channels.email && company.email) {
                               try {
                                    const htmlContent = specificDocs.length > 0 
                                    ? buildEmailHtml(msg.message, companySpecificDocs, settings?.emailSignature)
                                    : buildEmailHtml(msg.message, [], settings?.emailSignature);

                                    const emailList = company.email.split(',').map(e => e.trim()).filter(e => e);
                                    const mainEmail = emailList[0];
                                    const ccEmails = emailList.slice(1).join(', ');

                                    if (mainEmail) {
                                        const senderName = process.env.EMAIL_FROM_NAME || 'Contabilidade';
                                        const senderEmail = process.env.EMAIL_FROM_EMAIL || process.env.EMAIL_USER;
                                        const fromAddress = `"${senderName}" <${senderEmail}>`;

                                        const mailOptions = {
                                            from: fromAddress,
                                            to: mainEmail,
                                            cc: ccEmails,
                                            subject: msg.title,
                                            html: htmlContent,
                                            attachments: attachmentsToSend.map(a => ({ filename: a.filename, path: a.path, contentType: a.contentType }))
                                        };
                                        await emailTransporter.sendMail(mailOptions);
                                        await saveToImapSentFolder(mailOptions).catch(err => 
                                            log('[CRON] Falha ao salvar no IMAP', err)
                                        );
                                    }
                               } catch(e) { log(`[CRON] Erro email ${company.name}`, e); }
                            }

                            if (channels.whatsapp && company.whatsapp && clientReady) {
                                try {
                                    let number = company.whatsapp.replace(/\D/g, '');
                                    if (!number.startsWith('55')) number = '55' + number;
                                    const chatId = `${number}@c.us`;
                                    
                                    let waBody = `*${msg.title}*\n\n${msg.message}`;

                                    if (specificDocs.length > 0) {
                                        waBody = `*📄 Olá!* \n\n${msg.message}\n\n*Arquivos enviados:*`;
                                        const listaArquivos = attachmentsToSend.map(att => 
                                            `• ${att.docData?.docName || att.filename} (${att.docData?.category || 'Anexo'}, Venc: ${att.docData?.dueDate || 'N/A'})`
                                        ).join('\n');
                                        waBody += `\n${listaArquivos}`;
                                    } else if (attachmentsToSend.length > 0) {
                                        waBody += `\n\n*Arquivo enviado:* ${attachmentsToSend[0].filename}`;
                                    }
                                    
                                    waBody += `\n\n${settings?.whatsappTemplate || ''}`;

                                    await safeSendMessage(waWrapper.client, chatId, waBody);
                                    
                                    for (const att of attachmentsToSend) {
                                        try {
                                            const fileData = fs.readFileSync(att.path).toString('base64');
                                            const media = new MessageMedia(att.contentType, fileData, att.filename);
                                            await safeSendMessage(waWrapper.client, chatId, media);
                                            await new Promise(r => setTimeout(r, 3000));
                                        } catch (err) {
                                            log(`[CRON] Erro media zap ${att.filename}`, err);
                                        }
                                    }
                                } catch(e) { log(`[CRON] Erro zap ${company.name}`, e); }
                            }
                            
                            if (companySpecificDocs.length > 0) {
                                for (const doc of companySpecificDocs) {
                                    if (doc.category) {
                                        db.run(`INSERT INTO sent_logs (companyName, docName, category, sentAt, channels, status) VALUES (?, ?, ?, datetime('now', 'localtime'), ?, 'success')`, 
                                            [company.name, doc.docName, doc.category, JSON.stringify(channels)]);
                                        
                                        db.run(`INSERT INTO document_status (companyId, category, competence, status) VALUES (?, ?, ?, 'sent') ON CONFLICT(companyId, category, competence) DO UPDATE SET status='sent'`, 
                                            [doc.companyId, doc.category, doc.competence]);
                                    }
                                }
                            }
                        } 
                    } // Fim do bloco de msg para empresas

                    // Atualização da Recorrência (Para todos os tipos)
                    if (msg.recurrence === 'unico') {
                        db.run("UPDATE scheduled_messages SET active = 0 WHERE id = ?", [msg.id]);
                    } else {
                        const nextDate = new Date(msg.nextRun);
                        if (msg.recurrence === 'diaria') nextDate.setDate(nextDate.getDate() + 1);
                        else if (msg.recurrence === 'semanal') nextDate.setDate(nextDate.getDate() + 7);
                        else if (msg.recurrence === 'mensal') nextDate.setMonth(nextDate.getMonth() + 1);
                        else if (msg.recurrence === 'trimestral') nextDate.setMonth(nextDate.getMonth() + 3);
                        else if (msg.recurrence === 'anual') nextDate.setFullYear(nextDate.getFullYear() + 1);
                        
                        const nextRunStr = nextDate.toISOString().slice(0, 16);
                        db.run("UPDATE scheduled_messages SET nextRun = ? WHERE id = ?", [nextRunStr, msg.id]);
                    }
                } catch(e) {
                    log(`[CRON] Erro crítico processando msg ID ${msg.id}`, e);
                }
            } 
        });
    });
}, 60000); 

server.listen(port, () => log(`Server running at http://localhost:${port}`));