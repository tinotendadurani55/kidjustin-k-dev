
/*╔══════════════════════════════════════════════════════════════════╗
   ║ 🤖 KIDJUSTIN-K WHATSAPP BOT - ALL IN ONE                         ║
   ║ V13: FILE-BASED SESSION & KOYEB OPTIMIZED                      ║
   ╚══════════════════════════════════════════════════════════════════╝ */

// --- GLOBAL ANTI-CRASH SYSTEM ---
// Known non-fatal Baileys noise — skip logging these so they don't flood the console.
// 428 = WS closed while sending a retry-request; "Bad MAC" = stale signal session;
// "Connection Closed" = reconnect race condition.  None of these crash the bot.


function isBaileysNoise(reason) {
    if (!reason) return false;
    const msg = (reason?.message || reason?.output?.payload?.message || String(reason)).toLowerCase();
    return (
        msg.includes('bad mac') ||
        msg.includes('connection closed') ||
        msg.includes('connection lost') ||
        (reason?.output?.statusCode === 428)
    );
}

process.on('uncaughtException', (err) => {
    if (isBaileysNoise(err)) return;
    console.error('🚨 CRITICAL ERROR (Uncaught):', err);
});

process.on('unhandledRejection', (reason) => {
    if (isBaileysNoise(reason)) return;
    console.error('🚨 UNHANDLED REJECTION:', reason);
});


const express = require('express');
const app = express();

// --- 1. KOYEB STAY-AWAKE SYSTEM ---
app.get('/', (req, res) => res.send('Bot is active!'));
app.listen(process.env.PORT || 8000, () => {
    console.log('✅ Health check server is running on port 8000');
});

// --- 2. STANDARD IMPORTS ---
const { 
    default: makeWASocket, 
    DisconnectReason, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore, 
    WAMessageStubType, 
    generateWAMessageFromContent 
} = require('@whiskeysockets/baileys');

const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { exec } = require('child_process');
const cheerio = require('cheerio');
const { v4: uuidv4 } = require('uuid');
const os = require('os');
const fetch = require('node-fetch');

// 🧠 BRAIN CONFIG
const brainPath = path.join(__dirname, 'brain.json');

// Auto-create brain if missing
if (!fs.existsSync(brainPath)) {
    fs.writeFileSync(brainPath, JSON.stringify({}));
}

// Memory-efficient Load
function loadBrain() {
    try {
        return JSON.parse(fs.readFileSync(brainPath, 'utf-8'));
    } catch (e) {
        console.log("❌ Brain Read Error:", e.message);
        return {};
    }
}

// Disk-space-saving Save
function saveBrain(data) {
    try {
        // No indentation/whitespace to keep file size tiny
        fs.writeFileSync(brainPath, JSON.stringify(data));
    } catch (e) {
        console.log("❌ Brain Save Error:", e.message);
    }
}

// --- DATABASE (PostgreSQL — optional, falls back to file if not configured) ---
const postgres = require('postgres');
let sql = null;
let dbReady = false;

// Returns a promise that resolves once the DB is ready (or skipped)
const dbInitPromise = (async () => {
    if (process.env.DATABASE_HOST && process.env.DATABASE_NAME &&
        process.env.DATABASE_USER && process.env.DATABASE_PASSWORD) {
        sql = postgres({
            host:     process.env.DATABASE_HOST,
            database: process.env.DATABASE_NAME,
            username: process.env.DATABASE_USER,
            password: process.env.DATABASE_PASSWORD,
            ssl:      'require',
        });
        try {
            await sql`
                CREATE TABLE IF NOT EXISTS bot_settings (
                    key   TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
            `;
            dbReady = true;
            console.log('✅ Database connected and tables ready.');
        } catch (e) {
            console.error('❌ Database setup failed (will use file fallback):', e.message);
        }
    } else {
        console.log('[DB] ℹ️ No DATABASE_* env vars found — using local file for persistence.');
    }
})();

// --- FFMPEG & BINARY PATH DETECTOR ---
const isTermux = fs.existsSync('/data/data/com.termux');
const ffmpegPath = isTermux ? 'ffmpeg' : '/usr/bin/ffmpeg';
const ytdlpPath = isTermux ? 'yt-dlp' : '/usr/local/bin/yt-dlp';

console.log(`[System] Platform: ${isTermux ? 'Termux' : 'Linux/Koyeb'}`);
console.log(`[System] Using FFMPEG at: ${ffmpegPath}`);

// ═══════════════════════════════════════════════════════════════════
// ⚙️ BOT CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

const config = {
    botName: process.env.BOT_NAME || 'Kidjustin-k',
    ownerName: process.env.OWNER_NAME || 't.Durani',
    ownerNumber: (process.env.OWNER_NUMBER || '263777426534').replace(/[^\d]/g, ''),
    prefix: process.env.PREFIX || '.',
    mode: process.env.MODE || 'public',
    reportNumber: process.env.REPORT_NUMBER || '0777426534',
    sessionId: process.env.SESSION_ID // Used for Koyeb session restoration
};

const ownerJid = config.ownerNumber + '@s.whatsapp.net';

// Global variables to hold bot's state
let botJid = ''; 
let initialStatusSet = false; 

const botConfig = {
    menuImage:      'https://i.postimg.cc/htpZFLkb/IMG_20260328_WA0012.jpg',
    adminImage:     'https://i.postimg.cc/NfvzRf8n/IMG_20260328_WA0011.jpg',
    downloadsImage: 'https://i.postimg.cc/hvLM2T8r/IMG_20260328_WA0013.jpg',
    gamesImage:     'https://i.postimg.cc/PfpgmRgr/IMG_20260328_WA0004(1).jpg',
    aiImage:        'https://i.postimg.cc/BbS1GF9g/IMG_20260329_WA0006.jpg',
    ownerImage:     'https://i.postimg.cc/TYxtpNGz/IMG_20260328_WA0009.jpg',
    settingsImage:  'https://i.postimg.cc/SNcHPzNq/IMG_20260328_WA0008.jpg',
};

// V12 ADDED: Game State Management
// State now tracks current round, total questions, and pause timer
const activeGames = {}; 

// TTT Game State
const tttGames = {};

// Temp Mail Store (per sender JID)
const mailStore = {};

// User XP / Rep / Stats DB (in-memory, resets on restart)
const userDB = {};
const getUser = (jid) => {
    if (!userDB[jid]) userDB[jid] = { xp: 0, level: 1, rep: 0, commands: 0, repGivenTo: [] };
    return userDB[jid];
};
const XP_PER_CMD = 10;
const xpForLevel = (lvl) => lvl * 100;

// Group Rules DB
const groupRulesDB = {};

// AFK DB — { jid: { reason, time } }
const afkDB = {};

// ── STICKER METADATA HELPER ──────────────────────────────────────────────────
// Injects WhatsApp sticker pack info (pack name + author) into a WebP buffer.
// WhatsApp shows this when the user long-presses any sticker made by the bot.
function addStickerMetadata(webpBuffer, packName, authorName) {
    const metaJson = JSON.stringify({
        'sticker-pack-id': `kidjustin-k-${Date.now()}`,
        'sticker-pack-name': packName,
        'sticker-pack-publisher': authorName,
        'emojis': ['✨', '🎭']
    });
    const payload = Buffer.from(metaJson, 'utf-8');

    // Build a minimal TIFF/EXIF structure with one UserComment (0x9286) IFD entry
    const ifdOffset   = 8;
    const valueOffset = ifdOffset + 2 + 12 + 4; // header + numEntries + 1 entry + nextIFD
    const exifBuf = Buffer.alloc(valueOffset + payload.length);

    exifBuf.write('II', 0);                        // little-endian
    exifBuf.writeUInt16LE(42, 2);                  // TIFF magic
    exifBuf.writeUInt32LE(ifdOffset, 4);           // offset to IFD0

    let pos = ifdOffset;
    exifBuf.writeUInt16LE(1, pos); pos += 2;       // 1 IFD entry
    exifBuf.writeUInt16LE(0x9286, pos); pos += 2;  // tag: UserComment
    exifBuf.writeUInt16LE(7, pos); pos += 2;       // type: UNDEFINED
    exifBuf.writeUInt32LE(payload.length, pos); pos += 4;
    exifBuf.writeUInt32LE(valueOffset, pos); pos += 4;
    exifBuf.writeUInt32LE(0, pos);                 // next IFD = none
    payload.copy(exifBuf, valueOffset);

    // Wrap in WebP EXIF chunk: 'EXIF' + LE uint32 size + data (+ 1 pad byte if odd)
    const exifSize = Buffer.alloc(4);
    exifSize.writeUInt32LE(exifBuf.length, 0);
    const pad = exifBuf.length % 2 ? Buffer.from([0x00]) : Buffer.alloc(0);
    const exifChunk = Buffer.concat([Buffer.from('EXIF'), exifSize, exifBuf, pad]);

    // Append chunk to WebP and fix the RIFF file-size field
    const out = Buffer.concat([webpBuffer, exifChunk]);
    out.writeUInt32LE(out.length - 8, 4);
    return out;
}

// Poll DB — { groupJid: { question, options, votes: { optionIndex: [jids] } } }
const pollDB = {};

// Custom Welcome Messages — { groupJid: 'message with {name} and {group}' }
const customWelcomeDB = {};

// Anti-Spam config — configurable per group or globally
const spamConfig = { limit: 5, window: 10000 };

// Premium Users DB — { jid: { addedBy, addedAt } }
const premiumUsers = {};

// ────────────── AUTO-REPLY DATABASE ──────────────
// Custom learned replies (owner/admin teach via .learn)
const learnDB = {};

// Built-in common talk responses (always active, learnDB overrides them)
// Resolved at runtime so config.prefix is always current
const getDefaultReplies = () => ({
    'boring':          `Try a game! Type *${config.prefix}game* 🎮`,
    'bored':           `Try a game! Type *${config.prefix}game* 🎮`,
});

// Bot Settings DB (per group / global)
const settingsDB = {};
const getSettings = (jid) => {
    if (!settingsDB[jid]) settingsDB[jid] = { callblock: false, autoview: false, autotyping: true, antiflood: true };
    return settingsDB[jid];
};

// Maintenance-mode download error message
const MAINTENANCE_MSG =
`⚙️ *Service Temporarily Unavailable*
━━━━━━━━━━━━━━━━━━━
The download feature is currently under maintenance.
We'll notify you once it's back via *.update*

📢 Follow updates:
https://whatsapp.com/channel/0029Vb1JJlR9WtBzWg26wi3e
━━━━━━━━━━━━━━━━━━━
> © *t.Durani* | KIDJUSTIN-K V13`;

const gameQuestions = [
    {
        q: "Which company created the WhatsApp application?",
        a: "Facebook/Meta",
        options: ["Apple", "Facebook/Meta", "Google", "Microsoft"],
        category: "Tech"
    },
    {
        q: "What is the capital city of Zimbabwe?",
        a: "Harare",
        options: ["Bulawayo", "Mutare", "Harare", "Gweru"],
        category: "Geography"
    },
    {
        q: "Which metal is liquid at room temperature?",
        a: "Mercury",
        options: ["Gold", "Silver", "Mercury", "Lead"],
        category: "Science"
    },
    {
        q: "What is the common name for the gas water?",
        a: "Water",
        options: ["Oxygen", "Hydrogen Peroxide", "Water", "Methane"],
        category: "Science"
    },
    {
        q: "What programming language is this bot written in?",
        a: "Node.js (JavaScript)",
        options: ["Python", "PHP", "Node.js (JavaScript)", "Java"],
        category: "Tech"
    },
    {
        q: "What is the largest planet in our solar system?",
        a: "Jupiter",
        options: ["Saturn", "Jupiter", "Mars", "Earth"],
        category: "Science"
    },
    {
        q: "How many legs does a spider have?",
        a: "Eight",
        options: ["Six", "Four", "Ten", "Eight"],
        category: "Science"
    },
    {
        q: "What is the name of the owner of this bot?",
        a: config.ownerName,
        options: ["Elon Musk", config.botName, config.ownerName, "Mark Zuckerberg"],
        category: "Bot Info"
    },
    {
        q: "Which fictional city is the home of Batman?",
        a: "Gotham City",
        options: ["Star City", "Metropolis", "Gotham City", "Central City"],
        category: "Fun"
    },
    {
        q: "What is the smallest country in the world?",
        a: "Vatican City",
        options: ["Monaco", "Nauru", "Vatican City", "San Marino"],
        category: "Geography"
    },
    {
        q: "Which of these is a vegetable?",
        a: "Carrot",
        options: ["Apple", "Banana", "Carrot", "Grape"],
        category: "Fun"
    },
    {
        q: "What year was the first iPhone released?",
        a: "2007",
        options: ["2005", "2007", "2009", "2011"],
        category: "Tech"
    },
    {
        q: "What is the main ingredient in guacamole?",
        a: "Avocado",
        options: ["Tomato", "Lime", "Avocado", "Chili"],
        category: "Fun"
    },
    {
        q: "What is the chemical symbol for gold?",
        a: "Au",
        options: ["Ag", "Fe", "Au", "Pb"],
        category: "Science"
    },
    {
        q: "Which ocean is the largest?",
        a: "Pacific Ocean",
        options: ["Atlantic Ocean", "Indian Ocean", "Southern Ocean", "Pacific Ocean"],
        category: "Geography"
    }
];

// ═══════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS (UNCHANGED)
// ═══════════════════════════════════════════════════════════════════

function getUptime() {
    let seconds = process.uptime();
    const d = Math.floor(seconds / (3600 * 24));
    seconds -= d * (3600 * 24);
    const h = Math.floor(seconds / 3600);
    seconds -= h * 3600;
    const m = Math.floor(seconds / 60);
    seconds -= m * 60;
    const s = Math.floor(seconds);

    let uptime = "";
    if (d > 0) uptime += `${d} day${d > 1 ? 's' : ''}, `;
    if (h > 0) uptime += `${h} hour${h > 1 ? 's' : ''}, `;
    if (m > 0) uptime += `${m} minute${m > 1 ? 's' : ''}, `;
    uptime += `${s} second${s > 1 ? 's' : ''}`;
    
    return uptime.trim().replace(/,([^,]*)$/, '$1');
}
// ─── TTT HELPERS ───────────────────────────────────────────────────

const TTT_POSITION_NAMES = {
    7: '↖️ Top-Left',    8: '⬆️ Top-Center',    9: '↗️ Top-Right',
    4: '⬅️ Mid-Left',    5: '⏺️ Center',         6: '➡️ Mid-Right',
    1: '↙️ Bot-Left',    2: '⬇️ Bot-Center',     3: '↘️ Bot-Right'
};

async function sendTTTBoard(sock, from, m, game, headerText) {
    const board = renderTTTBoard(game.board);
    const currentPlayer = game.players[game.currentTurn];
    const symbol = game.symbols[currentPlayer];

    await sock.sendMessage(from, {
        text: `${board}\n\n${headerText}\n@${currentPlayer.split('@')[0]}'s turn (${symbol})\n\nType *${config.prefix}del [1-9]* to make your move (numpad layout)`,
        mentions: [currentPlayer]
    }, { quoted: m });
}

function renderTTTBoard(board) {
    const s = board.map((cell, i) => cell !== '' ? cell : String(i + 1));
    return (
        `┌───┬───┬───┐\n` +
        `│ ${s[6]} │ ${s[7]} │ ${s[8]} │\n` +
        `├───┼───┼───┤\n` +
        `│ ${s[3]} │ ${s[4]} │ ${s[5]} │\n` +
        `├───┼───┼───┤\n` +
        `│ ${s[0]} │ ${s[1]} │ ${s[2]} │\n` +
        `└───┴───┴───┘`
    );
}

function checkTTTWinner(board) {
    const lines = [
        [0,1,2],[3,4,5],[6,7,8],
        [0,3,6],[1,4,7],[2,5,8],
        [0,4,8],[2,4,6]
    ];
    for (const [a,b,c] of lines) {
        if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
    }
    return null;
}

function cleanDownloads() {
    const folder = './downloads';
    // Files to keep permanently — gitkeep placeholder and pre-cached menu music
    const keepFiles = new Set(['.gitkeep', 'menu-music.mp3']);
    let count = 0;
    let freedBytes = 0;
    if (fs.existsSync(folder)) {
        fs.readdirSync(folder).forEach(file => {
            if (keepFiles.has(file)) return;
            const curPath = path.join(folder, file);
            try {
                const stat = fs.statSync(curPath);
                freedBytes += stat.size;
                fs.unlinkSync(curPath);
                count++;
            } catch (_) {}
        });
        console.log(`[System] 🧹 Downloads folder purged. Removed ${count} file(s), freed ${(freedBytes / 1024 / 1024).toFixed(2)} MB.`);
    }
    return { count, freedMB: (freedBytes / 1024 / 1024).toFixed(2) };
}

async function isAdmin(sock, jid, participantJid) {
    if (!jid.endsWith('@g.us')) return false;
    try {
        const groupMetadata = await sock.groupMetadata(jid);
        const adminList = groupMetadata.participants
            .filter(p => p.admin !== null)
            .map(p => p.id);
        return adminList.includes(participantJid);
    } catch (e) {
        console.error('Error fetching group metadata:', e);
        return false;
    }
}

async function isBotAdmin(sock, jid) {
    if (!jid.endsWith('@g.us') || !botJid) return false;
    return isAdmin(sock, jid, botJid);
}

// ═══════════════════════════════════════════════════════════════════
// SELF-DIAGNOSIS (UNCHANGED)
// ═══════════════════════════════════════════════════════════════════

// Fixed checkBinary for non-termux environment
function checkBinary(name, installCommand) {
    return new Promise((resolve) => {
        exec(`${name} --version`, (error) => { 
            if (error) {
                console.log(`⚠️ Binary check for "${name}" failed, but we will proceed.`);
                resolve();
            } else {
                console.log(`✅ Binary check successful: "${name}" is available.`);
                resolve();
            }
        });
    });
}

async function selfDiagnosis() {
    console.log('\n--- 🛠️ RUNNING SELF-DIAGNOSIS CHECKS ---');
    
    try { require('cheerio'); console.log('✅ Node module check successful: "cheerio" is installed.'); } catch (e) { console.error('\n❌ CRITICAL ERROR: Node module "cheerio" is missing.'); console.error('   To fix, please run: npm install cheerio'); process.exit(1); }
    try { require('uuid'); console.log('✅ Node module check successful: "uuid" is installed.'); } catch (e) { console.error('\n❌ CRITICAL ERROR: Node module "uuid" is missing.'); console.error('   To fix, please run: npm install uuid'); process.exit(1); }

    await checkBinary('ffmpeg', 'pkg install ffmpeg');
    await checkBinary('yt-dlp', 'pip install yt-dlp'); 
    
    console.log('--- DIAGNOSIS COMPLETE: ALL SYSTEMS GO ---');
}

// --- WEATHER FUNCTION ---
async function getWeatherForecast(city) {
    try {
        // Tip: You need to add OPENWEATHERMAP_KEY to your Koyeb Environment Variables
        const apiKey = process.env.OPENWEATHERMAP_KEY;
        if (!apiKey) return "⚠️ Weather API Key missing in Koyeb settings.";

        const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric`;
        const response = await axios.get(url);
        const data = response.data;
        const flag = data.sys.country === 'ZW' ? '🇿🇼' : ''; 
        
        return `☀️ *Weather Report for ${data.name}* ${flag}\n\n` +
               `🌡️ *Temp:* ${data.main.temp}°C\n` +
               `☁️ *Sky:* ${data.weather[0].description}\n` +
               `💧 *Humidity:* ${data.main.humidity}%\n` +
               `💨 *Wind:* ${data.wind.speed} m/s`;
    } catch (err) {
        return `❌ Could not find weather for "${city}".`;
    }
}

// --- WALLPAPER FUNCTION ---
async function getWallpaper() {
    try {
        const uniqueSeed = Date.now();
        const imageUrl = `https://picsum.photos/1080/1920?unique=${uniqueSeed}`;
        const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        return Buffer.from(response.data);
    } catch (err) {
        return null;
    }
}


// ═══════════════════════════════════════════════════════════════════
// V12 GAME LOGIC FUNCTIONS (UNCHANGED)
// ═══════════════════════════════════════════════════════════════════

/**
 * Ends the game and announces the winner/scores with a performance rating.
 */
async function endGame(sock, jid, game) {
    clearTimeout(game.timer);
    delete activeGames[jid];

    let finalScores = Object.entries(game.scoreMap)
        .sort(([, scoreA], [, scoreB]) => scoreB - scoreA)
        .map(([jid, score]) => {
            const number = jid.split('@')[0];
            return `▸ @${number}: ${score}`;
        }).join('\n');

    if (finalScores.length === 0) finalScores = "No one scored!";
    
    const topScore = Object.values(game.scoreMap).reduce((max, score) => Math.max(max, score), 0);
    let rating;
    
    if (topScore >= 100) { // 10 correct answers out of 15
        rating = "👑 *WOW! That's excellent!* 🤯";
    } else if (topScore >= 50) { // 5 correct answers
        rating = "⭐ *Good Job! You passed!* 👍";
    } else {
        rating = "❌ *Try Again!* Better luck next time. 🙏";
    }

    const finalMessage = `
🎉 *GAME OVER! (15 Rounds Complete)* 🎉

${rating}

🥇 *FINAL SCOREBOARD:*
${finalScores}

_Next Level Coming Soon!_
Type *${config.prefix}game* to play again!
`;
    if (game.mSent && game.mSent.key) {
  await sock.sendMessage(jid, { text: finalMessage, mentions: Object.keys(game.scoreMap) }, { quoted: game.mSent });
} else {
  await sock.sendMessage(jid, { text: finalMessage, mentions: Object.keys(game.scoreMap) });
}
}

/**
 * Sends the next question or ends the game if max rounds are reached.
 */
async function sendNextQuestion(sock, jid) {
    const game = activeGames[jid];

    if (!game) return; // Safety check

    game.currentRound++;

    if (game.currentRound > game.maxRounds) {
        return endGame(sock, jid, game);
    }
    
    // Select a random question from the remaining pool and remove it
    const randomIndex = Math.floor(Math.random() * game.gameQuestionsRemaining.length);
    const randomQuestion = game.gameQuestionsRemaining.splice(randomIndex, 1)[0];
    
    // Randomize options order
    const options = randomQuestion.options.sort(() => Math.random() - 0.5);
    const answerIndex = options.indexOf(randomQuestion.a);
    const answerLetter = ['A', 'B', 'C', 'D'][answerIndex];

    const questionText = `
🧠 *QUIZ ROUND ${game.currentRound}/${game.maxRounds}* 🎮

*QUESTION:*
${randomQuestion.q}

*OPTIONS:*
A) ${options[0]}
B) ${options[1]}
C) ${options[2]}
D) ${options[3]}

*TO ANSWER:* Reply with *${config.prefix}answer <letter>*
*TIME LIMIT:* 30 seconds! Go!
`;
    
    // Update game state for the new round
    game.question = randomQuestion.q;
    game.correctAnswer = answerLetter;
    game.options = options;
    game.answeredUsers.clear(); // Reset answered users for the new round

    const mSent = await sock.sendMessage(jid, { text: questionText });
    game.mSent = mSent; // Store the key of the new question message

    // Start 30-second timer for the answer
    game.timer = setTimeout(async () => {
        // This executes if NO ONE answers the question in time
        const gameAfterTimeout = activeGames[jid];
        if (!gameAfterTimeout || gameAfterTimeout.sessionId !== game.sessionId) return;

        await sock.sendMessage(jid, { 
            text: `⏱️ *TIME UP!* The correct answer was *${game.correctAnswer}* (${randomQuestion.a}).\n\nStarting next round in 20 seconds...` 
        }, { quoted: game.mSent.key });

        // Start 20-second pause before next question
        setTimeout(() => sendNextQuestion(sock, jid), 20000); 

    }, 30000); // 30 seconds to answer
}


// ═══════════════════════════════════════════════════════════════════
// COMMAND DEFINITIONS 
// ═══════════════════════════════════════════════════════════════════

const commands = {    // ────────────── MENU ──────────────
    menu: {
        name: 'menu',
        aliases: ['help', 'commands'],
        desc: 'Show all command categories',
        category: 'general',
        async execute(ctx) {
            const { sock, from, m, pushName } = ctx;
            const uptime = getUptime();
            const timestamp = m.messageTimestamp * 1000;
            const speed = Date.now() - timestamp;
            const now = new Date();
            const dateStr = now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Harare' });
            const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Africa/Harare' });

            let menuText = `*💠⃝⃘̉̉̉━⋆─⋆──❂*
*KIDJUSTIN-K V13 PRO︎*
*╰────────────────❂*
*┏━━━━━━━━━━━━━⚡*
*┃* ⚡ *POWER CONSOLE*
*┗━━━━━━━━━━━━━⚡*
*┏━━━━━━━━━━━━━┓*
*┃* 👤 *USER:* ${pushName || '𝑲𝒊𝒅-𝒂𝒔𝒔𝒆𝒓 👑'}
*┃* 🔋 *MODE:* ${config.mode.toUpperCase()}
*┃* 🛰️ *PING:* ${speed} ms
*┃* 🛠️ *PREF:* [ ${config.prefix} ]
*┃* ⚙️ *ENGINE:* Node.js v20+
*┃* 🛡 *STATUS:* Vicious Mode Active
*┃* ⚡ *VERSION:* 13.0.1 [STABLE]
*┃* ✅ *CMD:* 100+ Loaded
*┗━━━━━━━━━━━━━┛*

*┏━「 📂 COMMAND CATEGORIES𓂃✍︎ 」*
*┃*
*┃* 🛡️ *${config.prefix}admin* — Security & Admin
*┃*    _(antilink, kick, warn, mute, promote...)_
*┃*
*┃* 📥 *${config.prefix}downloads* — Downloads
*┃*    _(play, tiktok, fb, ig, twitter, apk...)_
*┃*
*┃* 🎮 *${config.prefix}games* — Games & Fun
*┃*    _(game, ttt, 8ball, poll, afk, joke...)_
*┃*
*┃* 🤖 *${config.prefix}ai* — AI & Utility
*┃*    _(gpt, speak, calc, screenshot, logo...)_
*┃*
*┃* 👑 *${config.prefix}owner* — Owner & System
*┃*    _(ban, addprem, join, gitclone, bc...)_
*┃*
*┃* ⚙️ *${config.prefix}settings* — Bot Settings
*┃*    _(callblock, autoview, antiflood...)_
*┃*
*┗━━━━━━━━━━━━━❂*

*📊 SYSTEM STATUS𓂃✍︎*
*Uptime:* ${uptime}
*Device:* ${os.platform()}
*CMD:* 100+ loaded

━━━━━━━━━━━━━━━━━━━━━
*🕐* ${timeStr}  *📅* ${dateStr}
> © *t.Durani* | Harare, ZW𓂃✍︎🇿🇼`;

            // Send menu image immediately
            await sock.sendMessage(from, {
                image: { url: botConfig.menuImage },
                caption: menuText
            }, { quoted: m });

            // Send menu music async (non-blocking — arrives a few seconds after the menu)
            (async () => {
                try {
                    const menuMusicPath = './downloads/menu-music.mp3';
                    const tmpPath    = './downloads/menu-music-tmp.mp3';

                    // Download and cache once; re-download only if missing (e.g. after restart)
                    if (!fs.existsSync(menuMusicPath)) {
                        // Step 1: Download from SoundCloud — no cookies or auth required
                        const downloaded = await new Promise((resolve) => {
                            exec(
                                `${ytdlpPath} --no-playlist -x --audio-format mp3 --audio-quality 5 -o "${tmpPath}" "scsearch1:Ogryzek aura slowed"`,
                                (err) => resolve(!err && fs.existsSync(tmpPath))
                            );
                        });

                        // Step 2: Trim to 30 seconds with ffmpeg
                        if (downloaded) {
                            await new Promise((resolve) => {
                                exec(
                                    `${ffmpegPath} -y -i "${tmpPath}" -t 30 -acodec libmp3lame -q:a 5 "${menuMusicPath}"`,
                                    () => {
                                        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
                                        resolve();
                                    }
                                );
                            });
                        }
                    }

                    if (fs.existsSync(menuMusicPath)) {
                        const audioBuf = fs.readFileSync(menuMusicPath);
                        await sock.sendMessage(from, {
                            audio: audioBuf,
                            mimetype: 'audio/mpeg',
                            ptt: false
                        }, { quoted: m });
                    }
                } catch (e) {
                    // Music is optional — silently skip if anything fails
                }
            })();
        }
    },

    // ────────────── ADMIN SUBMENU ──────────────
    admin: {
        name: 'admin',
        aliases: ['security', 'sec'],
        desc: 'Show Security & Admin commands',
        category: 'general',
        async execute(ctx) {
            const { sock, from, m } = ctx;
            const now = new Date();
            const dateStr = now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Harare' });
            const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Africa/Harare' });

            const text = `*💠⃝⃘̉̉̉━⋆─⋆──❂*
*KIDJUSTIN-K V13 PRO︎*
*╰────────────────❂*

*┏━「 🛡️ SECURITY & ADMIN𓂃✍︎ 」*
*┃* ◈ *.antilink* [on/off]
*┃*    _Auto-delete links from non-admins_
*┃* ◈ *.welcome* [on/off]
*┃*    _Toggle group welcome message_
*┃* ◈ *.setwelcome* [message]
*┃*    _Set a custom welcome message_
*┃* ◈ *.warn* [mention]
*┃*    _Warn a member_
*┃* ◈ *.stats*
*┃*    _Show group stats_
*┃* ◈ *.tagall*
*┃*    _Tag all group members_
*┃* ◈ *.countmembers*
*┃*    _Count group members_
*┃* ◈ *.kick* [mention]
*┃*    _Remove a member_
*┃* ◈ *.add* [number]
*┃*    _Add a member_
*┃* ◈ *.promote* [mention]
*┃*    _Make member an admin_
*┃* ◈ *.demote* [mention]
*┃*    _Remove admin from member_
*┃* ◈ *.mute*
*┃*    _Only admins can send messages_
*┃* ◈ *.unmute*
*┃*    _Everyone can send messages_
*┃* ◈ *.group* [open/close]
*┃*    _Same as mute/unmute_
*┃* ◈ *.setname* [text]
*┃*    _Change group name_
*┃* ◈ *.setdesc* [text]
*┃*    _Change group description_
*┃* ◈ *.invite*
*┃*    _Get invite link (with group info)_
*┃* ◈ *.linkgc*
*┃*    _Get invite link (plain)_
*┃* ◈ *.revoke*
*┃*    _Reset & revoke invite link_
*┃* ◈ *.groupjid*
*┃*    _Show group JID_
*┃* ◈ *.setspam* [number]
*┃*    _Set anti-spam message limit_
*┃* ◈ *.clear*
*┃*    _Reset stuck games in group_
*┃* ◈ *.rules*
*┃*    _Show group rules_
*┃* ◈ *.addrule* [text]
*┃*    _Add a group rule_
*┃* ◈ *.delrule* [number]
*┃*    _Delete a rule by number_
*┃* ◈ *.clearrules*
*┃*    _Clear all group rules_
*┗━━━━━━━━━━━━━❂*

━━━━━━━━━━━━━━━━━━━━━
*🕐* ${timeStr}  *📅* ${dateStr}
> © *t.Durani* | Harare, ZW𓂃✍︎🇿🇼`;

            await sock.sendMessage(from, {
                image: { url: botConfig.adminImage },
                caption: text
            }, { quoted: m });
        }
    },

    // ────────────── DOWNLOADS SUBMENU ──────────────
    downloads: {
        name: 'downloads',
        aliases: ['dl', 'download'],
        desc: 'Show Download commands',
        category: 'general',
        async execute(ctx) {
            const { sock, from, m } = ctx;
            const now = new Date();
            const dateStr = now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Harare' });
            const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Africa/Harare' });

            const text = `*💠⃝⃘̉̉̉━⋆─⋆──❂*
*KIDJUSTIN-K V13 PRO︎*
*╰────────────────❂*

*┏━「 📥 DOWNLOADS𓂃✍︎ 」*
*┃* ◈ *.play* [song name]
*┃*    _Download song as audio (mp3)_
*┃* ◈ *.apk* [app name]
*┃*    _Download APK file directly_
*┃* ◈ *.tiktok* [link or search words]
*┃*    _Download TikTok video_
*┃* ◈ *.ig* [link]
*┃*    _Download Instagram Reels/Videos_
*┃* ◈ *.fb* [link]
*┃*    _Download Facebook Videos_
*┃* ◈ *.twitter* [link]
*┃*    _Download Twitter/X video_
*┃* ◈ *.pinterest* [link]
*┃*    _Download Pinterest Videos_
*┃* ◈ *.mediafire* [link]
*┃*    _Download from MediaFire_
*┃* ◈ *.sticker* [reply image]
*┃*    _Convert image to sticker_
*┃* ◈ *.toimage* [reply sticker]
*┃*    _Convert sticker to image_
*┃* ◈ *.vv* [reply view-once]
*┃*    _Bypass & save view-once media_
*┃* ◈ *.steal* [reply media]
*┃*    _Save forwarded status/media_
*┗━━━━━━━━━━━━━❂*

━━━━━━━━━━━━━━━━━━━━━
*🕐* ${timeStr}  *📅* ${dateStr}
> © *t.Durani* | Harare, ZW𓂃✍︎🇿🇼`;

            await sock.sendMessage(from, {
                image: { url: botConfig.downloadsImage },
                caption: text
            }, { quoted: m });
        }
    },

    // ────────────── GAMES SUBMENU ──────────────
    games: {
        name: 'games',
        aliases: ['fun', 'game_menu'],
        desc: 'Show Games & Fun commands',
        category: 'general',
        async execute(ctx) {
            const { sock, from, m } = ctx;
            const now = new Date();
            const dateStr = now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Harare' });
            const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Africa/Harare' });

            const text = `*💠⃝⃘̉̉̉━⋆─⋆──❂*
*KIDJUSTIN-K V13 PRO︎*
*╰────────────────❂*

*┏━「 🎮 GAMES & FUN𓂃✍︎ 」*
*┃* ◈ *.game*
*┃*    _Start a 15-round quiz game_
*┃* ◈ *.answer* [letter]
*┃*    _Answer current quiz question_
*┃* ◈ *.score*
*┃*    _Check current game scores_
*┃* ◈ *.ttt* [mention]
*┃*    _Play Tic-Tac-Toe vs someone_
*┃* ◈ *.del* [1-9]
*┃*    _Make your TTT move_
*┃* ◈ *.8ball* [question]
*┃*    _Ask the magic 8-ball_
*┃* ◈ *.poll* [question] | [opt1] | [opt2]
*┃*    _Create a group poll_
*┃* ◈ *.pollresults*
*┃*    _See current poll results_
*┃* ◈ *.endpoll*
*┃*    _End the current poll_
*┃* ◈ *.afk* [reason]
*┃*    _Set yourself as away_
*┃* ◈ *.lovemeter* [mention]
*┃*    _Check love % with someone_
*┃* ◈ *.slap* / *.kiss* / *.hug* [mention]
*┃* ◈ *.joke*
*┃*    _Get a random joke_
*┃* ◈ *.truth* / *.dare*
*┃* ◈ *.quote*
*┃*    _Random motivational quote_
*┃* ◈ *.flip* / *.roll* / *.random5*
*┗━━━━━━━━━━━━━❂*

━━━━━━━━━━━━━━━━━━━━━
*🕐* ${timeStr}  *📅* ${dateStr}
> © *t.Durani* | Harare, ZW𓂃✍︎🇿🇼`;

            await sock.sendMessage(from, {
                image: { url: botConfig.gamesImage },
                caption: text
            }, { quoted: m });
        }
    },

    // ────────────── AI & UTILITY SUBMENU ──────────────
    ai: {
        name: 'ai',
        aliases: ['utility', 'util', 'tools'],
        desc: 'Show AI & Utility commands',
        category: 'general',
        async execute(ctx) {
            const { sock, from, m } = ctx;
            const now = new Date();
            const dateStr = now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Harare' });
            const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Africa/Harare' });

            const text = `*💠⃝⃘̉̉̉━⋆─⋆──❂*
*KIDJUSTIN-K V13 PRO︎*
*╰────────────────❂*

*┏━「 🤖 AI & UTILITY𓂃✍︎ 」*
*┃* ◈ *.gpt* [query]
*┃*    _Ask the AI anything_
*┃* ◈ *.speak* [text]
*┃*    _Convert text to a voice note_
*┃* ◈ *.calc* [expression]
*┃*    _Calculate any math expression_
*┃* ◈ *.screenshot* [url]
*┃*    _Take a screenshot of a website_
*┃* ◈ *.createlogo* [text]
*┃*    _Generate a stylish logo image_
*┃* ◈ *.trs* [text]
*┃*    _Translate text_
*┃* ◈ *.weather* [city]
*┃*    _Get weather forecast_
*┃* ◈ *.lyrics* [song]
*┃*    _Get song lyrics_
*┃* ◈ *.news*
*┃*    _Get latest news_
*┃* ◈ *.rank*
*┃*    _Check your XP level & progress_
*┃* ◈ *.rep* [@user]
*┃*    _Give +1 reputation to someone_
*┃* ◈ *.profile* [@user]
*┃*    _View profile card & stats_
*┃* ◈ *.shorten* [url]
*┃*    _Shorten a long URL_
*┃* ◈ *.check* [number]
*┃*    _Check if a number is on WA_
*┃* ◈ *.remind* [time] [msg]
*┃*    _Set a reminder_
*┃* ◈ *.tempmail* / *.checkmail* / *.readmail*
*┃*    _Disposable email system_
*┃* ◈ *.fontstyle* / *.fancy* [text]
*┃* ◈ *.learn* [trigger] | [reply]
*┃*    _Teach the bot a custom reply_
*┃* ◈ *.listreplies* / *.unlearnreply*
*┃* ◈ *.techstack* / *.device*
*┃* ◈ *.exam* [subject]
*┃* ◈ *.wallet* [address]
*┗━━━━━━━━━━━━━❂*

━━━━━━━━━━━━━━━━━━━━━
*🕐* ${timeStr}  *📅* ${dateStr}
> © *t.Durani* | Harare, ZW𓂃✍︎🇿🇼`;

            await sock.sendMessage(from, {
                image: { url: botConfig.aiImage },
                caption: text
            }, { quoted: m });
        }
    },

    // ────────────── OWNER & SYSTEM SUBMENU ──────────────
    owner: {
        name: 'owner',
        aliases: ['system', 'sys', 'ownerlist'],
        desc: 'Show Owner & System commands',
        category: 'general',
        async execute(ctx) {
            const { sock, from, m } = ctx;
            const now = new Date();
            const dateStr = now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Harare' });
            const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Africa/Harare' });

            const text = `*💠⃝⃘̉̉̉━⋆─⋆──❂*
*KIDJUSTIN-K V13 PRO︎*
*╰────────────────❂*

*┏━「 👑 OWNER & SYSTEM𓂃✍︎ 」*
*┃* ◈ *.contact* / *.ownerinfo*
*┃*    _Get owner's clickable contact card_
*┃* ◈ *.ban* / *.unban* [@user]
*┃*    _Globally ban/unban from the bot_
*┃* ◈ *.addprem* [@user]
*┃*    _Grant premium status to a user_
*┃* ◈ *.delprem* [@user]
*┃*    _Remove premium status_
*┃* ◈ *.join* [invite link]
*┃*    _Make bot join a group_
*┃* ◈ *.left*
*┃*    _Make bot leave current group_
*┃* ◈ *.gitclone* [github url]
*┃*    _Clone a GitHub repository_
*┃* ◈ *.report* [username]
*┃*    _Lookup a profile report_
*┃* ◈ *.bc* [message]
*┃*    _Broadcast to all chats_
*┃* ◈ *.backup*
*┃*    _Backup bot session/data_
*┃* ◈ *.public* / *.self*
*┃*    _Switch bot mode_
*┃* ◈ *.restart* / *.shutdown*
*┃*    _Restart or shut down the bot_
*┃* ◈ *.cleancache*
*┃*    _Delete temp files & free up space_
*┃* ◈ *.ping* / *.speed* / *.calc*
*┃* ◈ *.update*
*┃*    _What's new in this version_
*┃* ◈ *.settings*
*┃*    _View & toggle all bot settings_
*┗━━━━━━━━━━━━━❂*

━━━━━━━━━━━━━━━━━━━━━
*🕐* ${timeStr}  *📅* ${dateStr}
> © *t.Durani* | Harare, ZW𓂃✍︎🇿🇼`;

            await sock.sendMessage(from, {
                image: { url: botConfig.ownerImage },
                caption: text
            }, { quoted: m });
        }
    },

        // ────────────── UPDATE COMMAND ──────────────
    update: {
        name: 'update',
        aliases: ['whatsnew', 'changelog'],
        desc: 'Show latest bot version and changelog',
        category: 'general',
        async execute(ctx) {
            const now = new Date();
            const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Harare' });

            const updateMessage =
`*💠⃝⃘̉̉̉━⋆─⋆──❂*
*KIDJUSTIN-K V13 PRO*
*╰────────────────❂*

*┏━「 🆕 CHANGELOG — V13 PRO𓂃✍︎ 」*
*┃*
*┃* ◈ *Category menu system* — 5 submenus
*┃*    (.admin .downloads .games .ai .owner)
*┃*
*┃* ◈ *TikTok search* — link OR search words
*┃* ◈ *YouTube audio* — improved audio extract
*┃* ◈ *APK* — 3 direct store links, never fails
*┃* ◈ *Lyrics* — dual-API with auto-fallback
*┃* ◈ *Checkmail* — direct email argument support
*┃*
*┃* ◈ *User Profiles* — XP, level, reputation
*┃* ◈ *.rank* — see your bot level & XP
*┃* ◈ *.rep* — give reputation to members
*┃* ◈ *.speak* — text-to-voice notes
*┃* ◈ *.ban / .unban* — global user block
*┃*
*┃* ◈ *Group Rules* — .rules / .addrule / .delrule
*┃* ◈ *Settings menu* — .settings for all toggles
*┃* ◈ *Call blocking* — auto-reject incoming calls
*┃* ◈ *Auto status view* — views stories silently
*┃* ◈ *Fake typing* — bot shows typing before reply
*┃*
*┗━━━━━━━━━━━━━❂*

📢 *Follow updates & announcements:*
https://whatsapp.com/channel/0029Vb1JJlR9WtBzWg26wi3e

━━━━━━━━━━━━━━━━━━━━━
*📅* ${dateStr} | *⚡ Version:* 13.0.1 [STABLE]
> © *t.Durani* | KIDJUSTIN-K V13`;

            await ctx.reply(updateMessage);
        }
    },
     
          // ────────────── PING ──────────────
    ping: {
    name: 'ping',
    desc: 'Check bot response speed',
    category: 'ai',
    async execute(ctx) {
        const start = Date.now();
        await ctx.react('⚡');
        const latency = Date.now() - start;
        
        const pingMsg = `
*╔═════════「 LATENCY 」═════════╗*
*┃* 🚀 *Speed:* ${latency}ms
*┃* 🛰️ *Status:* ${latency < 200 ? 'Excellent' : 'Stable'}
*╚══════════════════════════════╝*
`.trim();
        await ctx.reply(pingMsg);
    }
},


    // ────────────── CALCULATOR ──────────────
    calc: {
        name: 'calc',
        aliases: ['calculate', 'math'],
        desc: 'Calculate a math expression. Usage: .calc 10+5',
        category: 'general',
        async execute(ctx) {
            const { args } = ctx;
            const expr = args.join('').trim();
            if (!expr) {
                return ctx.reply(`🧮 *Calculator*\n\nUsage: *${config.prefix}calc <expression>*\nExample: *${config.prefix}calc 10+5*`);
            }
            // Only allow safe math characters
            if (!/^[\d\s\+\-\*\/\%\.\(\)]+$/.test(expr)) {
                return ctx.reply(`❌ Invalid expression. Only numbers and + - * / % ( ) are allowed.`);
            }
            try {
                const result = Function('"use strict"; return (' + expr + ')')();
                if (!isFinite(result)) return ctx.reply(`❌ Math error: result is not a valid number.`);
                await ctx.reply(
`🧮 *Calculator*
━━━━━━━━━━━━━━━━━━━
📝 *Expression:* ${expr}
✅ *Result:* ${result}
━━━━━━━━━━━━━━━━━━━
> © *${config.ownerName}* | ${config.botName}`
                );
            } catch (e) {
                await ctx.reply(`❌ Could not calculate: *${expr}*\nCheck your expression and try again.`);
            }
        }
    },

    // ────────────── OWNER ──────────────
    contact: {
        name: 'contact',
        aliases: ['creator', 'dev', 'ownerinfo'],
        desc: 'Display bot owner contact info',
        category: 'general',
        async execute(ctx) {
            const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${config.ownerName}\nORG:${config.botName};\nTEL;type=CELL;type=VOICE;waid=${config.ownerNumber}:+${config.ownerNumber}\nEND:VCARD`;
            await ctx.sock.sendMessage(ctx.from, {
                contacts: { displayName: config.ownerName, contacts: [{ vcard }] }
            }, { quoted: ctx.m });
            await ctx.reply(
`👑 *BOT OWNER INFO*
━━━━━━━━━━━━━━━━━━━
*Name:* ${config.ownerName}
*Number:* +${config.ownerNumber}
*Country:* Zimbabwe 🇿🇼
*Bot:* ${config.botName} V13
━━━━━━━━━━━━━━━━━━━
📩 _Contact the owner for support or custom bots._`
            );
        }
    },

// ────────────── STATUS (WORKING) ──────────────
status: { 
    name: 'status',
    aliases: ['device', 'system'],
    desc: 'Show bot performance and server status',
    category: 'ai',
    async execute(ctx) {
        const { sock, from, m: msg } = ctx;
        const uptimeSeconds = process.uptime();
        const hours = Math.floor(uptimeSeconds / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);
        const seconds = Math.floor(uptimeSeconds % 60);

        const usedRam = (process.memoryUsage().rss / 1024 / 1024).toFixed(2);
        const totalRam = (os.totalmem() / 1024 / 1024).toFixed(2);
        const ramPercent = ((usedRam / totalRam) * 100).toFixed(1);

        const statusMessage = `
*╔═════════「 SYSTEM STATUS 」═════════╗*
*┃* 🤖 *Bot:* Kidjustin-k V13
*┃* ⏱️ *Uptime:* ${hours}h ${minutes}m ${seconds}s
*┃* 💾 *RAM Usage:* ${usedRam}MB / ${totalRam}MB (${ramPercent}%)
*┃* ⚙️ *Platform:* ${os.platform()}
*┃* 🧬 *CPU:* ${os.cpus()[0].model.split('@')[0]}
*┃* 📡 *Latency:* ${Date.now() - msg.messageTimestamp * 1000}ms
*╚══════════════════════════════════╝*

*Status:* ${ramPercent > 80 ? '⚠️ HIGH LOAD' : '✅ STABLE'}`.trim();

        await sock.sendMessage(from, { text: statusMessage }, { quoted: msg });
    }
},

// ────────────── TOTAL (FIXED) ──────────────
total: {
    name: 'total',
    aliases: ['cmdcount', 'stats'],
    desc: 'Show total number of registered commands',
    category: 'ai', // Ensure this matches exactly
    async execute(ctx) {
        const { sock, from, m: msg } = ctx;
        const count = 121; 

        const statMsg = `
*╔═════════「 BOT STATISTICS 」═════════╗*
*┃* 🤖 *Version:* V13 (Gold Edition)
*┃* ⚡ *Total Commands:* ${count}
*┃* 🛠️ *Developer:* t.Durani (Kidjustin-k)
*┃* 🤝 *Partner:* Kid Asser (Vortex Tech)
*╚═══════════════════════════════════╝*`.trim();
        
        await sock.sendMessage(from, { text: statMsg }, { quoted: msg });
    }
},

// ────────────── MY ID (FIXED CATEGORY) ──────────────
myid: {
    name: 'myid',
    aliases: ['jid'],
    desc: 'Show your unique ID',
    category: 'ai', // Changed from 'general' to 'ai'
    async execute(ctx) {
        const { sock, from, m: msg } = ctx;
        const targetID = ctx.sender || msg.sender || msg.key.remoteJid;
        
        const idMsg = `📋 *Your ID:* \n\`\`\`${targetID}\`\`\``;
        await sock.sendMessage(from, { text: idMsg }, { quoted: msg });
    }
},

    // ────────────── SPEED (ADDED) ──────────────
    speed: {
        name: 'speed',
        aliases: ['test'],
        desc: 'Detailed latency test',
        category: 'general',
        async execute(ctx) {
            const start = Date.now();
            await ctx.reply('Testing speed...');
            const end = Date.now();
            await ctx.reply(`🚀 *Response Speed:* ${end - start}ms`);
        }
    },
    
// --- [ DOWNLOAD: TIKTOK (.tiktok) ] ---
    tiktok: {
        name: 'tiktok',
        desc: 'Download TikTok Video (link or search query)',
        category: 'download',
        async execute(ctx) {
            const input = ctx.args.join(' ');
            if (!input) return ctx.reply(`❌ Provide a TikTok link or search query.\n\nExamples:\n• *.tiktok https://tiktok.com/@user/video/...*\n• *.tiktok funny cats dancing*`);

            const isLink = input.includes('tiktok.com') || input.includes('vm.tiktok.com');
            const target = isLink ? input : `ttsearch1:${input}`;
            const fileName = `./downloads/${uuidv4()}.mp4`;

            await ctx.reply(isLink ? `📱 Fetching TikTok video...` : `🔍 Searching TikTok for: *${input}*\n⏳ Downloading top result...`);

            exec(`${ytdlpPath} -f "bestvideo+bestaudio/best" --merge-output-format mp4 -o "${fileName}" "${target}"`, async (err) => {
                if (err) {
                    console.error('[tiktok] yt-dlp error:', err);
                    return ctx.reply(MAINTENANCE_MSG);
                }
                if (!fs.existsSync(fileName)) return ctx.reply('❌ File not saved. Please try again.');
                await ctx.sock.sendMessage(ctx.from, { video: fs.readFileSync(fileName), caption: '✅ TikTok Downloaded' }, { quoted: ctx.m });
                if (fs.existsSync(fileName)) fs.unlinkSync(fileName);
            });
        }
    },

    // ────────────── MEDIAFIRE DOWNLOAD (V11 ADDED) ──────────────
        mediafire: {
        name: 'mediafire',
        desc: 'Download MediaFire link',
        category: 'download',
        async execute(ctx) {
            const mediafireUrl = ctx.args[0];
            if (!mediafireUrl || !mediafireUrl.includes('mediafire.com')) return ctx.reply('❌ Invalid Link');

            let tempFilePath;
            let fileName = 'file'; // Default
            let mimeType = 'application/octet-stream'; // Default

            try {
                const { data } = await axios.get(mediafireUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                    timeout: 12000
                });

                // Extract direct download URL via regex — works regardless of HTML structure changes
                const urlMatch = data.match(/https?:\/\/download\d*\.mediafire\.com\/[^"'\s]+/);
                const nameMatch = data.match(/class="filename[^"]*"[^>]*>([^<]+)</);
                const directUrl = urlMatch ? urlMatch[0] : null;
                fileName = (nameMatch ? nameMatch[1].trim() : null) || `file_${uuidv4()}`;

                if (!directUrl) return ctx.reply('❌ Could not find the download link. The file may be private or the link expired.');

                tempFilePath = path.join(__dirname, 'downloads', fileName);
                const writer = fs.createWriteStream(tempFilePath);
                const res = await axios({ method: 'get', url: directUrl, responseType: 'stream' });
                
                mimeType = res.headers['content-type'];
                res.data.pipe(writer);

                await new Promise((resolve) => writer.on('finish', resolve));

                await ctx.sock.sendMessage(ctx.from, { 
                    document: fs.readFileSync(tempFilePath), 
                    mimetype: mimeType, 
                    fileName: fileName 
                }, { quoted: ctx.m });

            } catch (e) {
                ctx.reply(`❌ Error: ${e.message}`);
            } finally {
                if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
            }
        }
    },
        // ────────────── EXAM PAPERS SEARCH (V12 WORKING) ──────────────
          exam: {
        name: 'exam',
        aliases: ['papers', 'zimsec', 'cambridge', 'revision'],
        desc: 'Search for past exam papers and revision links',
        category: 'ai',
        async execute(ctx) {
            if (ctx.args.length === 0) return ctx.reply('❌ Please specify the paper!\nExample: .exam Zimsec O Level Maths 2023');

            const query = ctx.args.join(' ');
            await ctx.react('📚');
            
            const encoded = encodeURIComponent(query);
            await ctx.reply(
`📖 *EXAM RESOURCES* 📚
━━━━━━━━━━━━━━━━━━━
🔍 *Search:* ${query}
━━━━━━━━━━━━━━━━━━━

*🇿🇼 Zimbabwe Resources:*
▸ https://revision.co.zw/search?s=${encoded}
▸ https://www.zimsec.co.zw/

*🌍 Cambridge Resources:*
▸ https://papers.gceguide.xyz/search?q=${encoded}
▸ https://www.cambridgeinternational.org/

*📄 PDF Search:*
▸ https://www.google.com/search?q=${encoded}+past+paper+filetype%3Apdf

━━━━━━━━━━━━━━━━━━━
_Tap any link to open it in your browser._`
            );
        }
    },
        // ────────────── TRANSLATE (V13 ADDED) ──────────────
    trs: {
        name: 'trs',
        aliases: ['translate', 'traduzir'],
        desc: 'Translate text to English (or specified language)',
        category: 'ai',
        async execute(ctx) {
            const args = ctx.args;
            if (args.length === 0) return ctx.reply('❌ Please provide text to translate!\n\n*Example:* .trs Hola como estas\n*Example (to specific language):* .trs fr|Hello (to French)');

            await ctx.react('🌍');

            let targetLang = 'en'; // Default to English
            let textToTranslate = args.join(' ');

            // Check if user specified a language (e.g., .trs fr|Hello)
            if (textToTranslate.includes('|')) {
                const split = textToTranslate.split('|');
                targetLang = split[0].trim().toLowerCase();
                textToTranslate = split[1].trim();
            }

            try {
                // MyMemory — free, no API key, very stable
                const res = await axios.get(
                    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(textToTranslate)}&langpair=auto|${targetLang}`,
                    { timeout: 10000 }
                );

                const translated = res.data?.responseData?.translatedText;
                if (!translated) throw new Error('No translation returned');

                const translationMsg = `
🌍 *TRANSLATION ENGINE* 🌍
*━━━━━━━━━━━━━━━━━━━*
📥 *Input:* ${textToTranslate}
📤 *Output (${targetLang.toUpperCase()}):* ${translated}
*━━━━━━━━━━━━━━━━━━━*
> © Kidjustin-k | 🇿🇼`.trim();

                await ctx.reply(translationMsg);
            } catch (e) {
                console.error("Translation Error:", e);
                await ctx.reply('❌ Translation service is currently busy. Please try again in a few seconds.');
            }
        }
    },
    // ────────────── STICKER (FUNCTIONAL) ──────────────
     sticker: {
        name: 'sticker',
        aliases: ['s', 'stiker'],
        desc: 'Convert image/video/gif to sticker',
        category: 'download',
        async execute(ctx) {
            const { sock, from, m: msg } = ctx; // Renamed to msg for clarity in callback

            const isQuoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const targetMessage = isQuoted ? msg.message.extendedTextMessage.contextInfo.quotedMessage : msg.message;
            const messageType = Object.keys(targetMessage)[0];
            
            if (!['imageMessage', 'videoMessage'].includes(messageType)) {
                return await ctx.reply(`❓ *Usage:* Reply to an image or short video/GIF with *${config.prefix}s*`);
            }

            await ctx.reply('⏳ *Processing your sticker...*');

            try {
                const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
                const type = messageType.replace('Message', '');
                const stream = await downloadContentFromMessage(targetMessage[messageType], type);

                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                const inputPath = path.join(os.tmpdir(), `input_${uuidv4()}`);
                const outputPath = path.join(os.tmpdir(), `output_${uuidv4()}.webp`);
                fs.writeFileSync(inputPath, buffer);

                const ffmpegCommand = `${ffmpegPath} -i "${inputPath}" -vcodec libwebp -filter:v "fps=fps=15,scale=512:512:flags=lanczos:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -lossless 1 -loop 0 -an "${outputPath}"`;

                exec(ffmpegCommand, async (err) => {
                    if (err) {
                        console.error("FFMPEG Error:", err);
                        return await sock.sendMessage(from, { text: "❌ *Error processing sticker.* Check video length." }, { quoted: msg });
                    }

                    const stickerBuf = fs.readFileSync(outputPath);
                    await sock.sendMessage(from, { sticker: stickerBuf }, { quoted: msg });

                    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                });

            } catch (error) {
                console.error("Sticker Command Error:", error);
                await ctx.reply("❌ *Failed to create sticker.*");
            }
        }
    },
    check: {
        name: 'check',
        desc: 'Check if a number is a Business account',
        category: 'general',
        async execute(ctx) {
            const num = ctx.args[0] ? ctx.args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : ctx.sender;
            const [result] = await ctx.sock.onWhatsApp(num);
            if (!result || !result.exists) return ctx.reply('❌ Number not on WhatsApp.');
            
            await ctx.reply(`📊 *WA CHECK:* @${num.split('@')[0]}\n\n*Exists:* ✅\n*Business:* ${result.isBusiness ? '✅ Yes' : '❌ No'}`, { mentions: [num] });
        }
    },
    fontstyle: {
        name: 'fontstyle',
        aliases: ['style', 'type'],
        desc: 'Change text to typewriter font',
        category: 'ai',
        async execute(ctx) {
            const text = ctx.args.join(' ');
            if (!text) return ctx.reply('❌ Provide text!\nExample: .fontstyle Hello World');
            const typewriter = '```' + text + '```';
            await ctx.reply(typewriter);
        }
    },
    toimage: {
        name: 'toimage',
        aliases: ['img', 'sticker2img'],
        desc: 'Convert sticker to image',
        category: 'download',
        async execute(ctx) {
            const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
            const isQuotedSticker = ctx.m.message.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage;
            if (!isQuotedSticker) return ctx.reply('❌ Reply to a *non-animated* sticker!');

            await ctx.react('📸');
            const stream = await downloadContentFromMessage(isQuotedSticker, 'image');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }

            await ctx.sock.sendMessage(ctx.from, { image: buffer, caption: '✅ Converted' }, { quoted: ctx.m });
        }
    },
    news: {
        name: 'news',
        aliases: ['headlines', 'breaking'],
        desc: 'Get the latest news headlines',
        category: 'ai',
        async execute(ctx) {
            await ctx.react('📰');
            try {
                // Free News API (No key required for this specific public endpoint)
                const res = await axios.get('https://api.spaceflightnewsapi.net/v4/articles/?limit=5');
                let newsTxt = `🌍 *LATEST GLOBAL HEADLINES*\n━━━━━━━━━━━━━━━━━━━\n\n`;
                res.data.results.forEach((art, i) => {
                    newsTxt += `*${i + 1}.* ${art.title}\n🔗 ${art.url}\n\n`;
                });
                await ctx.reply(newsTxt);
            } catch (e) {
                await ctx.reply('❌ News service is currently busy. Try again later.');
            }
        }
    },
    lyrics: {
        name: 'lyrics',
        aliases: ['song', 'lirik'],
        desc: 'Search for song lyrics',
        category: 'ai',
        async execute(ctx) {
            const songName = ctx.args.join(' ');
            if (!songName) return ctx.reply('❌ Provide a song name!\nExample: .lyrics Blinding Lights');

            await ctx.react('🎶');

            // Try multiple lyrics APIs in order
            const tryApis = [
                () => axios.get(`https://some-random-api.com/others/lyrics?title=${encodeURIComponent(songName)}`, { timeout: 10000 }),
                () => axios.get(`https://api.lyrics.ovh/v1/${encodeURIComponent(songName.split(' ')[0])}/${encodeURIComponent(songName.split(' ').slice(1).join(' ') || songName)}`, { timeout: 10000 }),
            ];

            for (const tryApi of tryApis) {
                try {
                    const res = await tryApi();
                    const data = res.data;

                    // some-random-api format
                    if (data && data.lyrics && data.title) {
                        const lyricsText = `🎵 *LYRICS: ${data.title.toUpperCase()}*\n🎤 *Artist:* ${data.author || 'Unknown'}\n\n${data.lyrics.slice(0, 3800)}\n\n> © Kidjustin-k V13 | 🎶`;
                        if (data.thumbnail && data.thumbnail.genius) {
                            await ctx.sock.sendMessage(ctx.from, { image: { url: data.thumbnail.genius }, caption: lyricsText }, { quoted: ctx.m });
                        } else {
                            await ctx.reply(lyricsText);
                        }
                        return;
                    }
                    // lyrics.ovh format
                    if (data && data.lyrics) {
                        const lyricsText = `🎵 *LYRICS: ${songName.toUpperCase()}*\n\n${data.lyrics.slice(0, 3800)}\n\n> © Kidjustin-k V13 | 🎶`;
                        await ctx.reply(lyricsText);
                        return;
                    }
                } catch (_) {}
            }

            await ctx.reply(`❌ Could not find lyrics for *"${songName}"*.\n\n_Try using the English title or artist name + song name._`);
        }
    },
    wallet: {
        name: 'wallet',
        desc: 'Check your bot credits',
        category: 'ai',
        async execute(ctx) {
            const balance = Math.floor(Math.random() * 500) + 50; // Placeholder random balance
            const walletText = `💳 *KIDJUSTIN-K WALLET*\n\n*Owner:* @${ctx.sender.split('@')[0]}\n*Balance:* $${balance}.00\n*Status:* Active ✅`;
            await ctx.reply(walletText);
        }
    },
    random5: {
        name: 'random5',
        aliases: ['top5', 'legends'],
        desc: 'Pick 5 random group members',
        category: 'fun',
        groupOnly: true,
        async execute(ctx) {
            const metadata = await ctx.sock.groupMetadata(ctx.from);
            const participants = metadata.participants.map(v => v.id);
            const picked = participants.sort(() => 0.5 - Math.random()).slice(0, 5);
            
            let text = `🏆 *THE TOP 5 LEGENDS:*\n\n`;
            picked.forEach((v, i) => { text += `${i + 1}. @${v.split('@')[0]}\n`; });
            await ctx.sock.sendMessage(ctx.from, { text: text, mentions: picked }, { quoted: ctx.m });
        }
    },
    lovemeter: {
        name: 'lovemeter',
        aliases: ['ship', 'love'],
        desc: 'Check love compatibility',
        category: 'fun',
        async execute(ctx) {
            const groupMetadata = ctx.isGroup ? await ctx.sock.groupMetadata(ctx.from) : null;
            const participants = groupMetadata ? groupMetadata.participants : [];
            const mentioned = ctx.m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            const target = mentioned || (participants.length > 0 ? participants[Math.floor(Math.random() * participants.length)].id : ctx.sender);
            
            const love = Math.floor(Math.random() * 100);
            const loveMsg = `❤️ *LOVE METER* ❤️\n\n@${ctx.sender.split('@')[0]} 💞 @${target.split('@')[0]}\n\n*Match:* ${love}%\n\n${love > 75 ? '🔥 True Love!' : love > 50 ? '💎 Potential.' : '❄️ Just Friends.'}`;
            
            await ctx.sock.sendMessage(ctx.from, { text: loveMsg, mentions: [ctx.sender, target] }, { quoted: ctx.m });
        }
    },
    shorten: {
        name: 'shorten',
        aliases: ['shortlink', 'tinyurl'],
        desc: 'Shorten a long URL',
        category: 'ai',
        async execute(ctx) {
            const url = ctx.args[0];
            if (!url) return ctx.reply('❌ Provide a link to shorten.');
            try {
                const res = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
                await ctx.reply(`🔗 *Shortened Link:* ${res.data}`);
            } catch (e) {
                await ctx.reply('❌ Failed to shorten link.');
            }
        }
    },
    revoke: {
        name: 'revoke',
        desc: 'Reset group invite link',
        category: 'group',
        groupOnly: true,
        adminOnly: true,
        botAdminOnly: true,
        async execute(ctx) {
            await ctx.sock.groupRevokeInvite(ctx.from);
            await ctx.reply('🚫 *Link Revoked!* The old group link is now dead.');
        }
    },

     // ────────────── WEATHER ──────────────
    weather: {
        name: 'weather',
        aliases: ['w', 'temp'],
        desc: 'Check local weather',
        category: 'ai',
        async execute(ctx) {
            const city = ctx.args.join(' ');
            if (!city) return await ctx.reply(`❓ Please provide a city. Example: *${config.prefix}weather Harare*`);
            
            const report = await getWeatherForecast(city);
            await ctx.reply(report);
        }
    },

    // ────────────── WALLPAPER ──────────────
        wallpaper: {
        name: 'wallpaper',
        aliases: ['wp', 'wall'],
        desc: 'Get a random HD wallpaper',
        category: 'ai',
        async execute(ctx) {
            await ctx.react('🖼️');
            const imageBuffer = await getWallpaper();
            
            if (imageBuffer) {
                // FIXED: Changed remoteJid to from, and msg to m
                await ctx.sock.sendMessage(ctx.from, { 
                    image: imageBuffer, 
                    caption: '✨ *Random HD Wallpaper (1080x1920)*' 
                }, { quoted: ctx.m });
            } else {
                await ctx.reply("❌ Failed to fetch wallpaper. Try again.");
            }
        }
        },

    // ────────────── GAME (QUIZ SYSTEM - V12 MODIFIED) ──────────────
    game: {
        name: 'game',
        aliases: ['quiz', 'playgame'],
        desc: 'Start a 15-round multiple-choice quiz game.',
        category: 'game',
        groupOnly: true,
        async execute(ctx) {
            const game = activeGames[ctx.from];

            if (game) {
                // If a game is active, show the current status
                let scoreBoard = Object.entries(game.scoreMap).map(([jid, score]) => {
                    const number = jid.split('@')[0];
                    return `▸ @${number}: ${score}`;
                }).join('\n');

                return ctx.sock.sendMessage(ctx.from, { 
                    text: `🎮 *GAME IS ALREADY ACTIVE!* ⏳\n\n*Round:* ${game.currentRound}/${game.maxRounds}\n*Question:* ${game.question}\n\n*Scores:*\n${scoreBoard}`,
                    mentions: Object.keys(game.scoreMap) 
                }, { quoted: ctx.m });
            }

            // Start a new game
            const sessionId = uuidv4();
            const maxRounds = 15;
            
            // Clone questions array to prevent modifying the source array
            const newGameQuestions = [...gameQuestions]; 

            const newGame = {
                sessionId: sessionId,
                currentRound: 0,
                maxRounds: maxRounds,
                question: '',
                correctAnswer: '',
                options: [],
                scoreMap: {}, // { senderJid: score }
                answeredUsers: new Set(),
                gameQuestionsRemaining: newGameQuestions, // Pool of questions
                timer: null,
                mSent: null // Key of the last question message
            };
            activeGames[ctx.from] = newGame;
            
            await ctx.reply(`🧠 *New Quiz Game Started!* 🎮 (15 Rounds total)\n\nGet ready for Round 1!`);
            
            // Start the first question after a short delay
            setTimeout(() => sendNextQuestion(ctx.sock, ctx.from), 5000); 
        }

    },
    // ────────────── ANSWER (QUIZ SYSTEM - V12 MODIFIED) ──────────────
    answer: {
        name: 'answer',
        aliases: ['ans'],
        desc: 'Answer the active quiz question.',
        category: 'game',
        groupOnly: true,
        async execute(ctx) {
            const game = activeGames[ctx.from];
            
            if (!game || game.currentRound === 0) {
                return ctx.reply(`❌ No active quiz game! Start one with *${config.prefix}game*.`);
            }
            
            if (game.answeredUsers.has(ctx.sender)) {
                return ctx.reply('❌ You have already answered this question!');
            }

            const userGuess = ctx.args[0]?.toUpperCase();
            if (!['A', 'B', 'C', 'D'].includes(userGuess)) {
                return ctx.reply(`❌ Invalid answer format. Please reply with *${config.prefix}answer <letter>*`);
            }
            
            // Clear the round timer immediately since someone answered
            clearTimeout(game.timer); 

            game.answeredUsers.add(ctx.sender);
            
            // Initialize score if necessary
            const currentScore = game.scoreMap[ctx.sender] || 0;
            
            let responseText = '';
            
            if (userGuess === game.correctAnswer) {
                game.scoreMap[ctx.sender] = currentScore + 10;
                responseText = `✅ *CORRECT!* You earned 10 points!\nYour total score: ${game.scoreMap[ctx.sender]}\n\nNext question in 20 seconds...`;
                await ctx.react('💯');
            } else {
                game.scoreMap[ctx.sender] = currentScore; // Score remains the same
                responseText = `❌ *WRONG!* The correct answer was *${game.correctAnswer}*.\nYour total score: ${game.scoreMap[ctx.sender]}\n\nNext question in 20 seconds...`;
                await ctx.react('❌');
            }
            
            // Reply to the user
            await ctx.reply(responseText);
            
            // Start 20-second pause before the next question starts
            game.timer = setTimeout(() => sendNextQuestion(ctx.sock, ctx.from), 20000);
            
            // If the last person answers, ensure the timer still runs for the next question
        }
    },
    // ────────────── SCORE (QUIZ SYSTEM - V12 ADDED) ──────────────
    score: {
        name: 'score',
        aliases: ['myscore', 'scoreboard'],
        desc: 'Display current quiz scores.',
        category: 'game',
        groupOnly: true,
        async execute(ctx) {
            const game = activeGames[ctx.from];

            if (!game) {
                return ctx.reply(`❌ No active quiz game! Start one with *${config.prefix}game*.`);
            }
            
            let scoreBoard = Object.entries(game.scoreMap)
                .sort(([, scoreA], [, scoreB]) => scoreB - scoreA) // Sort by highest score
                .map(([jid, score]) => {
                    const number = jid.split('@')[0];
                    return `▸ @${number}: ${score}`;
                }).join('\n');

            if (scoreBoard.length === 0) scoreBoard = "No points have been scored yet.";

            const scoreMessage = `
🏆 *CURRENT SCOREBOARD (Round ${game.currentRound}/${game.maxRounds})* 🏆

${scoreBoard}

*Next question:* ${game.question}
`;
            
            await ctx.sock.sendMessage(ctx.from, { 
                text: scoreMessage,
                mentions: Object.keys(game.scoreMap) 
            }, { quoted: ctx.m });
        }
    },
    // ────────────── CLEAR GAMES ──────────────
    clear: {
        name: 'clear',
        aliases: ['cleargame', 'resetgame', 'endgame'],
        desc: 'Force-clear any active game in this group (admin/owner only)',
        category: 'game',
        adminOnly: true,
        groupOnly: true,
        async execute(ctx) {
            const { from, reply } = ctx;
            let cleared = [];

            // Clear active quiz game
            if (activeGames[from]) {
                if (activeGames[from].timer) clearTimeout(activeGames[from].timer);
                delete activeGames[from];
                cleared.push('🧠 Quiz game');
            }

            // Clear active TTT game
            if (tttGames[from]) {
                delete tttGames[from];
                cleared.push('❎ Tic-Tac-Toe game');
            }

            if (cleared.length === 0) {
                return reply(`✅ No active games to clear in this group.`);
            }

            await reply(
`🧹 *Games Cleared!*
━━━━━━━━━━━━━━━━━━━
${cleared.map(g => `✔️ ${g} ended`).join('\n')}
━━━━━━━━━━━━━━━━━━━
All sessions reset. Start fresh with *${config.prefix}game* or *${config.prefix}ttt*`
            );
        }
    },

    // ────────────── AFK ──────────────
    afk: {
        name: 'afk',
        aliases: ['away'],
        desc: 'Set yourself as Away From Keyboard',
        category: 'general',
        async execute(ctx) {
            const reason = ctx.args.join(' ') || 'No reason given';
            afkDB[ctx.sender] = { reason, time: Date.now() };
            await ctx.reply(`😴 *AFK Mode Activated*\n\n*Reason:* ${reason}\n\nI'll notify anyone who mentions you.`);
        }
    },

    // ────────────── 8BALL ──────────────
    '8ball': {
        name: '8ball',
        aliases: ['eightball', 'magic'],
        desc: 'Ask the magic 8-ball a yes/no question',
        category: 'general',
        async execute(ctx) {
            const responses = [
                '✅ It is certain.', '✅ Without a doubt.', '✅ Yes, definitely!',
                '✅ You may rely on it.', '✅ As I see it, yes.', '✅ Most likely.',
                '✅ Outlook good.', '✅ Signs point to yes.',
                '🤔 Reply hazy, try again.', '🤔 Ask again later.',
                '🤔 Better not tell you now.', '🤔 Cannot predict now.',
                '❌ Don\'t count on it.', '❌ My reply is no.',
                '❌ My sources say no.', '❌ Outlook not so good.', '❌ Very doubtful.'
            ];
            const question = ctx.args.join(' ');
            if (!question) return ctx.reply(`🎱 *Magic 8-Ball*\n\nUsage: *${config.prefix}8ball <your question>*`);
            const answer = responses[Math.floor(Math.random() * responses.length)];
            await ctx.reply(`🎱 *Magic 8-Ball*\n\n❓ *Q:* ${question}\n\n🔮 *A:* ${answer}`);
        }
    },

    // ────────────── POLL ──────────────
    poll: {
        name: 'poll',
        aliases: ['vote', 'createpoll'],
        desc: 'Create a poll. Usage: .poll Question | Option1 | Option2 | ...',
        category: 'group',
        groupOnly: true,
        async execute(ctx) {
            const input = ctx.args.join(' ');
            const parts = input.split('|').map(p => p.trim()).filter(Boolean);
            if (parts.length < 3) {
                return ctx.reply(`📊 *Poll Usage:*\n\n*${config.prefix}poll Question | Option1 | Option2 | ...*\n\nExample:\n*${config.prefix}poll Best colour? | Red | Blue | Green*`);
            }
            const question = parts[0];
            const options = parts.slice(1);
            pollDB[ctx.from] = { question, options, votes: {}, voters: {} };
            options.forEach((_, i) => { pollDB[ctx.from].votes[i] = 0; });

            let optionsList = options.map((o, i) => `*${i + 1}.* ${o}`).join('\n');
            await ctx.reply(
`📊 *POLL STARTED*
━━━━━━━━━━━━━━━━━━━
❓ *${question}*
━━━━━━━━━━━━━━━━━━━
${optionsList}
━━━━━━━━━━━━━━━━━━━
Vote by typing the number (1, 2, 3...)
View results: *${config.prefix}pollresults*
End poll: *${config.prefix}endpoll*`
            );
        }
    },

    pollresults: {
        name: 'pollresults',
        aliases: ['voteresults', 'results'],
        desc: 'Show current poll results',
        category: 'group',
        groupOnly: true,
        async execute(ctx) {
            const poll = pollDB[ctx.from];
            if (!poll) return ctx.reply(`❌ No active poll. Start one with *${config.prefix}poll*.`);
            const total = Object.values(poll.votes).reduce((a, b) => a + b, 0);
            let results = poll.options.map((o, i) => {
                const count = poll.votes[i] || 0;
                const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
                return `*${i + 1}.* ${o}\n   ${bar} ${pct}% (${count} vote${count !== 1 ? 's' : ''})`;
            }).join('\n\n');
            await ctx.reply(`📊 *POLL RESULTS*\n━━━━━━━━━━━━━━━━━━━\n❓ *${poll.question}*\n━━━━━━━━━━━━━━━━━━━\n${results}\n━━━━━━━━━━━━━━━━━━━\n👥 Total votes: ${total}`);
        }
    },

    endpoll: {
        name: 'endpoll',
        aliases: ['closepoll', 'stoppoll'],
        desc: 'End the active poll and show final results',
        category: 'group',
        groupOnly: true,
        adminOnly: true,
        async execute(ctx) {
            const poll = pollDB[ctx.from];
            if (!poll) return ctx.reply(`❌ No active poll to end.`);
            const total = Object.values(poll.votes).reduce((a, b) => a + b, 0);
            let results = poll.options.map((o, i) => {
                const count = poll.votes[i] || 0;
                const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
                return `*${i + 1}.* ${o}\n   ${bar} ${pct}% (${count})`;
            }).join('\n\n');
            const winner = poll.options[Object.entries(poll.votes).sort((a, b) => b[1] - a[1])[0][0]];
            delete pollDB[ctx.from];
            await ctx.reply(`🏁 *POLL CLOSED — FINAL RESULTS*\n━━━━━━━━━━━━━━━━━━━\n❓ *${poll.question}*\n━━━━━━━━━━━━━━━━━━━\n${results}\n━━━━━━━━━━━━━━━━━━━\n🏆 *Winner:* ${winner}\n👥 Total votes: ${total}`);
        }
    },

    // ────────────── COUNT MEMBERS ──────────────
    countmembers: {
        name: 'countmembers',
        aliases: ['members', 'membercount'],
        desc: 'Show group member statistics',
        category: 'group',
        groupOnly: true,
        async execute(ctx) {
            const meta = await ctx.sock.groupMetadata(ctx.from);
            const all = meta.participants;
            const admins = all.filter(p => p.admin !== null);
            const lids = all.filter(p => p.id.endsWith('@lid'));
            const regular = all.filter(p => p.id.endsWith('@s.whatsapp.net'));
            await ctx.reply(
`👥 *GROUP MEMBER COUNT*
━━━━━━━━━━━━━━━━━━━
*Group:* ${meta.subject}
━━━━━━━━━━━━━━━━━━━
👥 *Total Members:* ${all.length}
👑 *Admins:* ${admins.length}
📱 *Regular (visible):* ${regular.length}
🔒 *Hidden (LID):* ${lids.length}
━━━━━━━━━━━━━━━━━━━
> © *${config.ownerName}* | ${config.botName}`
            );
        }
    },

    // ────────────── SET WELCOME ──────────────
    setwelcome: {
        name: 'setwelcome',
        aliases: ['customwelcome', 'welcomemsg'],
        desc: 'Set a custom welcome message. Use {name} and {group} as placeholders.',
        category: 'group',
        groupOnly: true,
        adminOnly: true,
        async execute(ctx) {
            const msg = ctx.args.join(' ');
            if (!msg) {
                return ctx.reply(
`👋 *Set Custom Welcome Message*
━━━━━━━━━━━━━━━━━━━
Usage: *${config.prefix}setwelcome Your message here*

Placeholders:
• *{name}* — member's username
• *{group}* — group name

Example:
*${config.prefix}setwelcome Welcome {name} to {group}! 🎉 Read the rules first.*

To reset to default: *${config.prefix}setwelcome reset*`
                );
            }
            if (msg.toLowerCase() === 'reset') {
                delete customWelcomeDB[ctx.from];
                return ctx.reply('✅ Welcome message reset to default.');
            }
            customWelcomeDB[ctx.from] = msg;
            const preview = msg.replace('{name}', ctx.pushName).replace('{group}', 'This Group');
            await ctx.reply(`✅ *Custom welcome message saved!*\n\n*Preview:*\n${preview}`);
        }
    },

    // ────────────── SET SPAM LIMIT ──────────────
    setspam: {
        name: 'setspam',
        aliases: ['spamthreshold', 'antispam'],
        desc: 'Set the anti-spam message limit (owner only). Usage: .setspam 3',
        category: 'owner',
        ownerOnly: true,
        async execute(ctx) {
            const num = parseInt(ctx.args[0]);
            if (!num || num < 1 || num > 20) {
                return ctx.reply(`🛡️ *Anti-Spam Config*\n\nCurrent limit: *${spamConfig.limit} messages / 10 seconds*\n\nUsage: *${config.prefix}setspam <number>*\nRange: 1–20\n\nExample: *${config.prefix}setspam 3* (stricter)`);
            }
            spamConfig.limit = num;
            await ctx.reply(`✅ *Anti-spam limit updated!*\nNew threshold: *${num} messages per 10 seconds*\nAnyone exceeding this (except owner) will be ignored.`);
        }
    },

    // ────────────── TAGALL ──────────────
    tagall: {
        name: 'tagall',
        aliases: ['everyone', 'totag', 'hidetag'],
        desc: 'Tag all members',
        category: 'group',
        groupOnly: true,
        adminOnly: true, 
        async execute(ctx) {
            try {
                const groupMetadata = await ctx.sock.groupMetadata(ctx.from);
                const participants = groupMetadata.participants;
                const message = ctx.args.join(' ') || '📢 Attention everyone!';

                let mentions = [];
                let text = `╔══════════════════╗\n║  *GROUP TAG* ║\n╚══════════════════╝\n\n📢 *${message}* (Total: ${participants.length})\n\n`;

                participants.forEach((p, i) => {
                    mentions.push(p.id);
                    text += `▸ @${p.id.split('@')[0]}\n`;
                });

                await ctx.sock.sendMessage(ctx.from, { text, mentions }, { quoted: ctx.m });

            } catch (e) {
                await ctx.reply('❌ Failed to tag members!');
            }
        }
    },
    // ────────────── ADD ──────────────
    add: {
        name: 'add',
        aliases: [],
        desc: 'Add user to group',
        category: 'group',
        groupOnly: true,
        adminOnly: true,
        botAdminOnly: true, 
        async execute(ctx) {
            if (ctx.args.length === 0) {
                return ctx.reply('❌ Please provide a number!\n\nExample: .add 263718555584');
            }

            try {
                let number = ctx.args[0].replace(/[^0-9]/g, '');
                const user = number + '@s.whatsapp.net';
                await ctx.sock.groupParticipantsUpdate(ctx.from, [user], 'add');
                await ctx.reply(`✅ Successfully added +${number}!`);
            } catch (e) {
                await ctx.reply('❌ Failed to add user. Ensure the number is valid and the bot is an admin.');
            }
        }
    },

    // ────────────── BACKUP SESSION (NEW) ──────────────
    backup: {
        name: 'backup',
        desc: 'Backup the session folder as a ZIP file',
        category: 'owner',
        ownerOnly: true,
        async execute(ctx) {
            const archiver = require('archiver');
            const sessionPath = path.join(__dirname, 'session');

            if (!fs.existsSync(sessionPath)) {
                return ctx.reply('❌ Session folder not found!');
            }

            await ctx.react('📂');
            const backupFile = path.join(__dirname, 'session_backup.zip');
            const output = fs.createWriteStream(backupFile);
            const archive = archiver('zip', { zlib: { level: 9 } });

            output.on('close', async () => {
                await ctx.sock.sendMessage(ctx.from, {
                    document: fs.readFileSync(backupFile),
                    fileName: 'session_backup.zip',
                    mimetype: 'application/zip',
                    caption: `📦 *KidJustin-K Session Backup*\n\nKeep this file safe! You can use it to restore your bot without scanning a QR code.`
                }, { quoted: ctx.m });
                
                fs.unlinkSync(backupFile); // Clean up after sending
                await ctx.react('✅');
            });

            archive.on('error', (err) => { throw err; });
            archive.pipe(output);
            archive.directory(sessionPath, false);
            await archive.finalize();
        }
    },

    // ────────────── KICK ──────────────
    kick: {
        name: 'kick',
        aliases: ['remove'],
        desc: 'Kick user from group',
        category: 'group',
        groupOnly: true,
        adminOnly: true,
        botAdminOnly: true, 
        async execute(ctx) {
            const mentioned = ctx.m.message?.extendedTextMessage?.contextInfo?.mentionedJid;
            if (!mentioned || mentioned.length === 0) {
                return ctx.reply('❌ Please mention someone!\n\nExample: .kick @user');
            }

            try {
                await ctx.sock.groupParticipantsUpdate(ctx.from, mentioned, 'remove');
                await ctx.reply('✅ User kicked!');
            } catch (e) {
                await ctx.reply('❌ Failed to kick user. Ensure the bot is an admin.');
            }
        }
    },
        // ────────────── PROMOTE ──────────────
    promote: {
        name: 'promote',
        aliases: [],
        desc: 'Promote to admin',
        category: 'group',
        groupOnly: true,
        adminOnly: true,
        botAdminOnly: true,
        async execute(ctx) {
            const mentioned = ctx.m.message?.extendedTextMessage?.contextInfo?.mentionedJid;
            if (!mentioned || mentioned.length === 0) {
                return ctx.reply('❌ Please mention someone!\n\nExample: .promote @user');
            }

            try {
                await ctx.sock.groupParticipantsUpdate(ctx.from, mentioned, 'promote');
                await ctx.reply('✅ User promoted to admin!');
            } catch (e) {
                await ctx.reply('❌ Failed to promote user. Ensure the bot is an admin.');
            }
        }
    },
      // Fixed BC Command
    bc: {
        name: 'bc',
        aliases: ['broadcast'],
        desc: 'Send a message to all groups',
        category: 'owner',
        ownerOnly: true,
        async execute(ctx) {
            const text = ctx.args.join(" ");
            if (!text) return ctx.reply("❌ What do you want to broadcast?");

            const groups = Object.keys(await ctx.sock.groupFetchAllParticipating());
            await ctx.reply(`📢 Sending broadcast to ${groups.length} groups...`);

            for (let i of groups) {
                await ctx.sock.sendMessage(i, { text: `📢 *KIDJUSTIN-K ANNOUNCEMENT*\n\n${text}\n\n_Sent by Owner_` });
            }
            await ctx.reply("✅ Broadcast finished.");
        }
    },

    // Slap Command
    slap: {
        name: 'slap',
        aliases: [],
        desc: 'Slap someone',
        category: 'fun',
        async execute(ctx) {
            const mentioned = ctx.m.message?.extendedTextMessage?.contextInfo?.mentionedJid;
            if (!mentioned || mentioned.length === 0) return ctx.reply('❌ Mention someone to slap!');

            const slapper = ctx.sender.split('@')[0];
            const slapped = mentioned[0].split('@')[0]; // Fixed spelling

            const msgs = [
                `👋 *${slapper}* slapped *${slapped}* across the face! 💥`,
                `👋 *SLAP!* *${slapper}* just slapped *${slapped}*! 😵`
            ];

            await ctx.sock.sendMessage(ctx.from, {
                text: msgs[Math.floor(Math.random() * msgs.length)],
                mentions: [ctx.sender, ...mentioned]
            }, { quoted: ctx.m });
            await ctx.react('👋');
        }
    },
       // ────────────── DEMOTE ──────────────
    demote: {
        name: 'demote',
        aliases: [],
        desc: 'Remove admin rights',
        category: 'group',
        groupOnly: true,
        adminOnly: true,
        botAdminOnly: true,
        async execute(ctx) {
            const mentioned = ctx.m.message?.extendedTextMessage?.contextInfo?.mentionedJid;
            if (!mentioned || mentioned.length === 0) {
                return ctx.reply('❌ Please mention someone!\n\nExample: .demote @user');
            }

            try {
                await ctx.sock.groupParticipantsUpdate(ctx.from, mentioned, 'demote');
                await ctx.reply('✅ Admin rights removed!');
            } catch (e) {
                await ctx.reply('❌ Failed to demote user. Ensure the bot is an admin.');
            }
        }
    },
    // ────────────── GROUP SETTINGS ──────────────
    group: {
        name: 'group',
        aliases: ['gc'],
        desc: 'Close/Open group chat',
        category: 'group',
        groupOnly: true,
        adminOnly: true,
        botAdminOnly: true,
        async execute(ctx) {
            if (ctx.args[0] === 'open') {
                await ctx.sock.groupSettingUpdate(ctx.from, 'not_announcement');
                await ctx.reply('🔓 Group opened! Everyone can send messages.');
            } else if (ctx.args[0] === 'close') {
                await ctx.sock.groupSettingUpdate(ctx.from, 'announcement');
                await ctx.reply('🔒 Group closed! Only admins can send messages.');
            } else {
                await ctx.reply('❌ Usage: .group open/close');
            }
        }
    },
        fancy: {
        name: 'fancy',
        aliases: ['font', 'style'],
        desc: 'Convert text to aesthetic fonts',
        category: 'fun',
        async execute(ctx) {
            if (ctx.args.length === 0) return ctx.reply('❌ Please provide text!\nExample: .fancy Kidjustin');
            
            const input = ctx.args.join(' ');
            
            // Character Maps
            const script = {
                'a':'𝓪','b':'𝓫','c':'𝓬','d':'𝓭','e':'𝓮','f':'𝓯','g':'𝓰','h':'𝓱','i':'𝓲','j':'𝓳','k':'𝓴','l':'𝓵','m':'𝓶','n':'𝓷','o':'𝓸','p':'𝓹','q':'𝓺','r':'𝓻','s':'𝓼','t':'𝓽','u':'𝓾','v':'𝓿','w':'𝔀','x':'𝔁','y':'𝔂','z':'𝔃',
                'A':'𝓐','B':'𝓑','C':'𝓒','D':'𝓓','E':'𝓔','F':'𝓕','G':'𝓖','H':'𝓗','I':'𝓘','J':'𝓙','K':'𝓚','L':'𝓛','M':'𝓜','N':'𝓝','O':'𝓞','P':'𝓟','Q':'𝓠','R':'𝓡','S':'𝓢','T':'𝓣','U':'𝓤','V':'𝓥','W':'𝓦','X':'𝓧','Y':'𝓨','Z':'𝓩'
            };
            
            const double = {
                'a':'𝕒','b':'𝕓','c':'𝕔','d':'𝕕','e':'𝕖','f':'𝕗','g':'𝕘','h':'𝕙','i':'𝕚','j':'𝕛','k':'𝕜','l':'𝕝','m':'𝕞','n':'𝕟','o':'𝕠','p':'𝕡','q':'𝕢','r':'𝕣','s':'𝕤','t':'𝕥','u':'𝕦','v':'𝕧','w':'𝕨','x':'𝕩','y':'𝕪','z':'𝕫',
                'A':'𝔸','B':'𝔹','C':'ℂ','D':'𝔻','E':'𝔼','F':'𝔽','G':'𝔾','H':'ℍ','I':'𝕀','J':'𝕁','K':'𝕂','L':'𝕃','M':'𝕄','N':'ℕ','O':'𝕆','P':'ℙ','Q':'ℚ','R':'ℝ','S':'𝕊','T':'𝕋','U':'𝕌','V':'𝕍','W':'𝕎','X':'𝕏','Y':'𝕐','Z':'ℤ'
            };

            const convert = (text, map) => text.split('').map(char => map[char] || char).join('');

            const result = `
✨ *FANCY TEXT GENERATOR* ✨

*Script:*
${convert(input, script)}

*Double-Struck:*
${convert(input, double)}

_Copy and paste to use in your bio!_
`;
            await ctx.reply(result);
        }
    },
    remind: {
        name: 'remind',
        desc: 'Set a quick reminder (minutes)',
        category: 'utility',
        async execute(ctx) {
            if (ctx.args.length < 2) return ctx.reply('❌ Usage: .remind 5 Drink water');
            const mins = parseInt(ctx.args[0]);
            const task = ctx.args.slice(1).join(' ');
            await ctx.reply(`✅ I will remind you to "${task}" in ${mins} minute(s).`);
            setTimeout(() => {
                ctx.sock.sendMessage(ctx.sender, { text: `⏰ *REMINDER:* ${task}` });
            }, mins * 60000);
        }
    },
    flip: {
        name: 'flip',
        desc: 'Flip a coin',
        category: 'fun',
        async execute(ctx) {
            const result = Math.random() < 0.5 ? 'HEADS 🪙' : 'TAILS 🪙';
            await ctx.reply(`The coin landed on: *${result}*`);
        }
    },
    roll: {
        name: 'roll',
        desc: 'Roll a die',
        category: 'fun',
        async execute(ctx) {
            const score = Math.floor(Math.random() * 6) + 1;
            await ctx.reply(`🎲 You rolled a: *${score}*`);
        }
    },

    // ────────────── SETGROUPNAME ──────────────
    setname: {
        name: 'setname',
        desc: 'Change group subject',
        category: 'group',
        groupOnly: true,
        adminOnly: true,
        botAdminOnly: true,
        async execute(ctx) {
            if (!ctx.args[0]) return ctx.reply('❌ Provide a new name.');
            await ctx.sock.groupUpdateSubject(ctx.from, ctx.args.join(' '));
            await ctx.reply('✅ Group name updated!');
        }
    },
    // ────────────── SETGROUPDESC ──────────────
    setdesc: {
        name: 'setdesc',
        desc: 'Change group description',
        category: 'group',
        groupOnly: true,
        adminOnly: true,
        botAdminOnly: true,
        async execute(ctx) {
            if (!ctx.args[0]) return ctx.reply('❌ Provide a new description.');
            await ctx.sock.groupUpdateDescription(ctx.from, ctx.args.join(' '));
            await ctx.reply('✅ Group description updated!');
        }
    },
    // ────────────── LINKGC ──────────────
    linkgc: {
        name: 'linkgc',
        aliases: ['gclink', 'grouplink'],
        desc: 'Get group invite link',
        category: 'group',
        groupOnly: true,
        adminOnly: true,
        botAdminOnly: true,
        async execute(ctx) {
            try {
                const link = await ctx.sock.groupInviteCode(ctx.from);
                await ctx.reply(`🔗 *Group Link*\n\nhttps://chat.whatsapp.com/${link}`);
            } catch (e) {
                await ctx.reply('❌ Failed to get link! Ensure the bot is an admin.');
            }
        }
    },
    // ────────────── GROUPJID ──────────────
    groupjid: {
        name: 'groupjid',
        aliases: ['jid'],
        desc: 'Get group/chat ID',
        category: 'general',
        async execute(ctx) {
            await ctx.reply(`📋 *JID:* ${ctx.from}`);
        }
    },
    // ────────────── KISS ──────────────
    kiss: {
        name: 'kiss',
        aliases: [],
        desc: 'Kiss someone',
        category: 'fun',
        async execute(ctx) {
            const mentioned = ctx.m.message?.extendedTextMessage?.contextInfo?.mentionedJid;
            if (!mentioned || mentioned.length === 0) {
                return ctx.reply('❌ Please mention someone!\n\nExample: .kiss @user');
            }

            const kisser = ctx.sender.split('@')[0];
            const kissed = mentioned[0].split('@')[0];

            const msgs = [
                `💋 *${kisser}* gave *${kissed}* a sweet kiss! 😘`,
                `💋 *${kisser}* kissed *${kissed}*! How romantic! 💕`,
                `💋 *Muah!* *${kisser}* kissed *${kissed}*! ❤️`
            ];

            await ctx.sock.sendMessage(ctx.from, {
                text: msgs[Math.floor(Math.random() * msgs.length)],
                mentions: [ctx.sender, ...mentioned]
            }, {
                quoted: ctx.m
            });
        }
    },
    // ────────────── HUG ──────────────
    hug: {
        name: 'hug',
        aliases: [],
        desc: 'Hug someone',
        category: 'fun',
        async execute(ctx) {
            const mentioned = ctx.m.message?.extendedTextMessage?.contextInfo?.mentionedJid;
            if (!mentioned || mentioned.length === 0) {
                return ctx.reply('❌ Please mention someone!\n\nExample: .hug @user');
            }

            const hugger = ctx.sender.split('@')[0];
            const hugged = mentioned[0].split('@')[0];

            const msgs = [
                `🤗 *${hugger}* gave *${hugged}* a warm hug! 🫂`,
                `🤗 *${hugger}* hugged *${hugged}* tightly! ❤️`,
                `🤗 *Group hug!* *${hugger}* is hugging *${hugged}*! 🥰`
            ];

            await ctx.sock.sendMessage(ctx.from, {
                text: msgs[Math.floor(Math.random() * msgs.length)],
                mentions: [ctx.sender, ...mentioned]
            }, {
                quoted: ctx.m
            });
        }
    },
    // ────────────── JOKE ──────────────
    joke: {
        name: 'joke',
        aliases: [],
        desc: 'Random joke',
        category: 'fun',
        async execute(ctx) {
            try {
                const res = await axios.get('https://official-joke-api.appspot.com/random_joke');
                await ctx.reply(`😂 *JOKE*\n\n${res.data.setup}\n\n_${res.data.punchline}_ 🤣`);
            } catch (e) {
                const jokes = [
                    {
                        s: "Why don't scientists trust atoms?",
                        p: "Because they make up everything!"
                    },
                    {
                        s: "What do you call a fake noodle?",
                        p: "An impasta!"
                    }
                ];
                const j = jokes[Math.floor(Math.random() * jokes.length)];
                await ctx.reply(`😂 *JOKE*\n\n${j.s}\n\n_${j.p}_ 🤣`);
            }
        }
    },
    // ────────────── TRUTH ──────────────
    truth: {
        name: 'truth',
        aliases: [],
        desc: 'Truth question',
        category: 'fun',
        async execute(ctx) {
            const truths = [
                'What is your biggest fear?',
                'Have you ever lied to your best friend?',
                'What is the most embarrassing thing you\'ve done?',
                'Who was your first crush?',
                'What is your biggest secret?',
                'Have you ever cheated on a test?',
            ];
            await ctx.reply(`🎯 *TRUTH*\n\n${truths[Math.floor(Math.random() * truths.length)]}`);
        }
    },
    // ────────────── DARE ──────────────
    dare: {
        name: 'dare',
        aliases: [],
        desc: 'Dare challenge',
        category: 'fun',
        async execute(ctx) {
            const dares = [
                'Send a voice message singing your favorite song',
                'Change your status to something embarrassing for 1 hour',
                'Call a random contact and say "I love you"',
                'Do 20 push-ups and send a video',
            ];
            await ctx.reply(`🎲 *DARE*\n\n${dares[Math.floor(Math.random() * dares.length)]}\n\n_Are you brave enough?_ 😏`);
        }
    },
    // ────────────── QUOTE ──────────────
    quote: {
        name: 'quote',
        aliases: ['inspire'],
        desc: 'Inspirational quote',
        category: 'fun',
        async execute(ctx) {
            try {
                const res = await axios.get('https://api.quotable.io/random');
                await ctx.reply(`💭 *QUOTE*\n\n"_${res.data.content}_"\n\n— ${res.data.author}`);
            } catch (e) {
                const quotes = [
                    {
                        c: 'The only way to do great work is to love what you do.',
                        a: 'Steve Jobs'
                    },
                    {
                        c: 'Success is not final, failure is not fatal.',
                        a: 'Winston Churchill'
                    }
                ];
                const q = quotes[Math.floor(Math.random() * quotes.length)];
                await ctx.reply(`💭 *QUOTE*\n\n"_${q.c}_"\n\n— ${q.a}`);
            }
        }
    },
    // ────────────── AI ──────────────
    gpt: {
        name: 'gpt',
        aliases: ['chatgpt', 'bot', 'askai'],
        desc: 'Ask AI a question',
        category: 'ai',
        async execute(ctx) {
            if (ctx.args.length === 0) {
                return ctx.reply('❌ Please ask a question!\n\nExample: .gpt What is the capital of Zimbabwe?');
            }

            const question = ctx.args.join(' ');
            await ctx.react('🤔');

            try {
                // Using a simple chatbot API placeholder. Replace with OpenAI or similar if needed.
                const res = await axios.get(`https://api.popcat.xyz/chatbot?msg=${encodeURIComponent(question)}&owner=${config.ownerName}`);
                await ctx.reply(`🤖 *AI Response*\n\n${res.data.response}`);
            } catch (e) {
                await ctx.reply('🤖 Sorry, I couldn\'t process that. Try again! (API check failed)');
            }
        }
    },
    // ────────────── SELF MODE ──────────────
    self: {
        name: 'self',
        aliases: [],
        desc: 'Owner or Admin mode',
        category: 'owner',
        ownerOnly: true,
        async execute(ctx) {
            config.mode = 'self';
            await ctx.reply('✅ Bot switched to *SELF MODE*\nOnly owner and admins can use commands now.');
        }
    },
    // ────────────── PUBLIC MODE ──────────────
    public: {
        name: 'public',
        aliases: [],
        desc: 'Everyone can use',
        category: 'owner',
        ownerOnly: true,
        async execute(ctx) {
            config.mode = 'public';
            await ctx.reply('✅ Bot switched to *PUBLIC MODE*\nEveryone can use commands now.');
        }
    },
    // ────────────── SHUTDOWN ──────────────
    shutdown: {
        name: 'shutdown',
        aliases: ['stop'],
        desc: 'Stop bot',
        category: 'owner',
        ownerOnly: true,
        async execute(ctx) {
            await ctx.reply('👋 Shutting down...\nGoodbye!');
            setTimeout(() => {
                ctx.sock.end();
                process.exit(0);
            }, 2000);
        }
    },
    // ────────────── RESTART (ADDED) ──────────────
    restart: {
        name: 'restart',
        aliases: ['reboot'],
        desc: 'Restart bot',
        category: 'owner',
        ownerOnly: true,
        async execute(ctx) {
            await ctx.reply('🔄 Restarting...\nI\'ll be back!');
            setTimeout(() => {
                process.exit(1);
            }, 2000);
        }
    },
    // ────────────── CLEAN CACHE ──────────────
    cleancache: {
        name: 'cleancache',
        aliases: ['cleantemp', 'purge', 'cleartemp'],
        desc: 'Delete all temp download files to free up space',
        category: 'owner',
        ownerOnly: true,
        async execute(ctx) {
            await ctx.react('🧹');
            const folder = './downloads';
            const keepFiles = new Set(['.gitkeep', 'menu-music.mp3']);
            let count = 0;
            let freedBytes = 0;

            if (fs.existsSync(folder)) {
                fs.readdirSync(folder).forEach(file => {
                    if (keepFiles.has(file)) return;
                    const curPath = path.join(folder, file);
                    try {
                        const stat = fs.statSync(curPath);
                        freedBytes += stat.size;
                        fs.unlinkSync(curPath);
                        count++;
                    } catch (_) {}
                });
            }

            const freeMB = (freedBytes / 1024 / 1024).toFixed(2);
            const freeRAM = (os.freemem() / 1024 / 1024).toFixed(0);
            const totalRAM = (os.totalmem() / 1024 / 1024).toFixed(0);
            const usedRAM = (totalRAM - freeRAM);
            const ramPct = ((usedRAM / totalRAM) * 100).toFixed(1);

            await ctx.reply(
`🧹 *Cache Cleaned!*
━━━━━━━━━━━━━━━━━━━
🗑️ *Files removed:* ${count}
💾 *Space freed:* ${freeMB} MB
━━━━━━━━━━━━━━━━━━━
📊 *RAM after clean:*
${usedRAM} MB used / ${totalRAM} MB total (${ramPct}%)

✅ Menu music & session files untouched.`
            );
        }
    },
    // ────────────── REPORT (ADDED) ──────────────
    report: {
        name: 'report',
        aliases: ['bug', 'contact'],
        desc: 'Report a bug to the owner',
        category: 'general',
        async execute(ctx) {
            if (!ctx.args[0]) return ctx.reply('❌ Please describe the bug or issue.');
            const reportMsg = `🚨 *NEW BUG REPORT*\n\n*From:* @${ctx.sender.split('@')[0]}\n*Issue:* ${ctx.args.join(' ')}`;
            // Using the specific report number as requested
            const reportJid = config.reportNumber + '@s.whatsapp.net';
            await ctx.sock.sendMessage(reportJid, { text: reportMsg, mentions: [ctx.sender] });
            await ctx.reply('✅ Your report has been sent to the developer. Thank you!');
        }
    },

    // ────────────── TECHSTACK ──────────────
    techstack: {
    name: 'techstack',
    aliases: ['stack'],
    desc: 'Show bot tech stack',
    category: 'ai',
    async execute(ctx) {
        const stackInfo = `
*╔═════════「 TECH STACK 」═════════╗*
*┃* 🧠 *Runtime:* Node.js
*┃* 📚 *Library:* Baileys
*┃* 💻 *Language:* JavaScript
*┃* ☁️ *Deploy:* VPS / Cloud
*┃* 💾 *Database:* Local / JSON
*╚══════════════════════════════════╝*
`.trim();
        await ctx.reply(stackInfo);
    }
},

    // ────────────── DEVICE ──────────────
    device: {
    name: 'device',
    aliases: ['info', 'system'],
    desc: 'Show device information',
    category: 'ai',
    async execute(ctx) {
        const deviceInfo = `
*╔═════════「 DEVICE INFO 」═════════╗*
*┃* 📱 *Model:* ${os.type()}
*┃* ⚙️ *Platform:* ${os.platform()}
*┃* 🏗️ *Arch:* ${os.arch()}
*┃* 💾 *RAM Total:* ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB
*┃* 🔬 *CPU Cores:* ${os.cpus().length}
*┃* ⏱️ *Uptime:* ${Math.floor(process.uptime() / 3600)}h
*╚══════════════════════════════════╝*
`.trim();
        await ctx.reply(deviceInfo);
    }
},

    // ────────────── 🛡️ ADDED: NEW SECURITY COMMANDS (V15.5) ──────────────
    antilink: {
        name: 'antilink',
        desc: 'Enable/Disable Auto-Kick for external links',
        category: 'group',
        groupOnly: true,
        adminOnly: true,
        botAdminOnly: true,
        async execute(ctx) {
            if (ctx.args[0] === 'on') {
                secDB.antiLink[ctx.from] = true;
                await ctx.reply('🛡️ *Anti-Link Enabled:* Anyone sending links (except admins) will be kicked.');
            } else if (ctx.args[0] === 'off') {
                secDB.antiLink[ctx.from] = false;
                await ctx.reply('🔓 *Anti-Link Disabled.*');
            } else {
                await ctx.reply('❌ Usage: .antilink on/off');
            }
        }
    },
    welcome: {
        name: 'welcome',
        desc: 'Toggle welcome message for new members',
        category: 'group',
        groupOnly: true,
        adminOnly: true,
        async execute(ctx) {
            if (ctx.args[0] === 'on') {
                secDB.welcome[ctx.from] = true;
                await ctx.reply('👋 *Welcome Mode Enabled.* Bot will now greet new members.');
            } else if (ctx.args[0] === 'off') {
                secDB.welcome[ctx.from] = false;
                await ctx.reply('🚪 *Welcome Mode Disabled.*');
            } else {
                await ctx.reply('❌ Usage: .welcome on/off');
            }
        }
    },
    warn: {
        name: 'warn',
        desc: 'Give a formal warning to a user',
        category: 'group',
        groupOnly: true,
        adminOnly: true,
        async execute(ctx) {
            const mentioned = ctx.m.message?.extendedTextMessage?.contextInfo?.mentionedJid;
            if (!mentioned) return ctx.reply('❌ Please mention a user to warn.');
            const target = mentioned[0];

            // Safety: Don't warn owner or bot
            if (target === ownerJid || target === botJid) {
                return ctx.reply('❌ Cannot warn the Owner or the Bot.');
            }

            secDB.strikes[target] = (secDB.strikes[target] || 0) + 1;
            const remains = 3 - secDB.strikes[target];
            if (secDB.strikes[target] >= 3) {
                 await ctx.sock.groupParticipantsUpdate(ctx.from, [target], "remove");
                 return ctx.reply(`🚫 @${target.split('@')[0]} reached 3 warnings and was kicked.`, { mentions: [target] });
            }
            await ctx.reply(`⚠️ @${target.split('@')[0]} has been warned. [${secDB.strikes[target]}/3]\nNext warning leads to kick.`, { mentions: [target] });
        }
    },
    stats: {
        name: 'stats',
        desc: 'Show group activity statistics',
        category: 'group',
        groupOnly: true,
        async execute(ctx) {
            const metadata = await ctx.sock.groupMetadata(ctx.from);
            const stats = `
📊 *GROUP STATS: ${metadata.subject}*
━━━━━━━━━━━━━━━━━━━
👥 Members: ${metadata.participants.length}
📅 Created: ${new Date(metadata.creation * 1000).toLocaleDateString()}
👑 Owner: @${metadata.owner?.split('@')[0] || 'Unknown'}
🛡️ Anti-Link: ${secDB.antiLink[ctx.from] ? '✅' : '❌'}
👋 Welcome: ${secDB.welcome[ctx.from] ? '✅' : '❌'}
━━━━━━━━━━━━━━━━━━━
`;
            await ctx.reply(stats, { mentions: [metadata.owner] });
        }
    },

    // ────────────── TWITTER / X DOWNLOAD ──────────────
    twitter: {
        name: 'twitter',
        aliases: ['xdl', 'x'],
        desc: 'Download video from X/Twitter',
        category: 'download',
        async execute(ctx) {
            const url = ctx.args[0];
            if (!url) return ctx.reply(`❌ Provide an X/Twitter video link.\nExample: *${config.prefix}twitter https://x.com/...*`);
            if (!url.match(/twitter\.com|x\.com/i)) return ctx.reply('❌ That does not look like an X/Twitter link.');

            await ctx.react('⏳');
            await ctx.reply('📥 Downloading X/Twitter video...');
            try {
                const cobaltRes = await axios.post('https://api.cobalt.tools/', {
                    url, downloadMode: 'auto', videoQuality: '720'
                }, { headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, timeout: 20000 });

                const { status, url: directUrl, urls } = cobaltRes.data;
                const finalUrl = (status === 'tunnel' || status === 'redirect') ? directUrl
                    : (status === 'picker' && urls?.length > 0) ? urls[0].url : null;

                if (!finalUrl) return ctx.reply('❌ Could not extract video. Make sure the tweet is public.');

                const videoRes = await axios.get(finalUrl, {
                    responseType: 'arraybuffer', timeout: 60000,
                    headers: { 'User-Agent': 'Mozilla/5.0' }, maxRedirects: 10
                });
                const buffer = Buffer.from(videoRes.data);
                if (buffer.length > 70 * 1024 * 1024) return ctx.reply('❌ Video too large to send (limit: 70MB).');
                await ctx.sock.sendMessage(ctx.from, { video: buffer, mimetype: 'video/mp4', caption: '✅ *X/Twitter Downloaded!*' }, { quoted: ctx.m });
                await ctx.react('✅');
            } catch (e) {
                console.error('[twitter] error:', e.message);
                await ctx.reply('❌ Download failed. The tweet may be private or the link invalid.');
            }
        }
    },

    // ────────────── INSTAGRAM DOWNLOAD ──────────────
    ig: {
        name: 'ig',
        aliases: ['instagram', 'insta', 'reel'],
        desc: 'Download Instagram Reels/Videos',
        category: 'download',
        async execute(ctx) {
            const url = ctx.args[0];
            if (!url) return ctx.reply(`❌ Provide an Instagram link.\nExample: *${config.prefix}ig https://www.instagram.com/reel/...*`);
            if (!url.match(/instagram\.com/i)) return ctx.reply('❌ That does not look like an Instagram link.');

            await ctx.react('⏳');
            await ctx.reply('📥 Downloading Instagram video...');
            try {
                const cobaltRes = await axios.post('https://api.cobalt.tools/', {
                    url, downloadMode: 'auto', videoQuality: '720'
                }, { headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, timeout: 20000 });

                const { status, url: directUrl, urls } = cobaltRes.data;
                const finalUrl = (status === 'tunnel' || status === 'redirect') ? directUrl
                    : (status === 'picker' && urls?.length > 0) ? urls[0].url : null;

                if (!finalUrl) return ctx.reply('❌ Could not extract video. Make sure the post is public.');

                const videoRes = await axios.get(finalUrl, {
                    responseType: 'arraybuffer', timeout: 60000,
                    headers: { 'User-Agent': 'Mozilla/5.0' }, maxRedirects: 10
                });
                const buffer = Buffer.from(videoRes.data);
                if (buffer.length > 70 * 1024 * 1024) return ctx.reply('❌ Video too large to send (limit: 70MB).');
                await ctx.sock.sendMessage(ctx.from, { video: buffer, mimetype: 'video/mp4', caption: '✅ *Instagram Downloaded!*' }, { quoted: ctx.m });
                await ctx.react('✅');
            } catch (e) {
                console.error('[ig] error:', e.message);
                await ctx.reply('❌ Download failed. The post may be private or the link invalid.');
            }
        }
    },

    // ────────────── FACEBOOK DOWNLOAD ──────────────
    fb: {
        name: 'fb',
        aliases: ['facebook', 'fbdl'],
        desc: 'Download Facebook Videos',
        category: 'download',
        async execute(ctx) {
            const url = ctx.args[0];
            if (!url) return ctx.reply(`❌ Provide a Facebook video link.\nExample: *${config.prefix}fb https://www.facebook.com/...*`);
            if (!url.match(/facebook\.com|fb\.watch/i)) return ctx.reply('❌ That does not look like a Facebook link.');

            await ctx.react('⏳');
            const fileName = `./downloads/${uuidv4()}.mp4`;
            // Use H.264+AAC so WhatsApp can actually play the video
            exec(`${ytdlpPath} --no-playlist -f "best[ext=mp4]/best" --recode-video mp4 --postprocessor-args "ffmpeg:-vcodec libx264 -acodec aac -movflags +faststart" -o "${fileName}" "${url}"`, async (err) => {
                if (err) { console.error('[fb] yt-dlp error:', err); return ctx.reply('❌ Download failed. The video may be private or the link invalid.'); }
                if (!fs.existsSync(fileName)) return ctx.reply('❌ File not saved. Please try again.');
                const buf = fs.readFileSync(fileName);
                await ctx.sock.sendMessage(ctx.from, { video: buf, mimetype: 'video/mp4', caption: '✅ *Facebook Video Downloaded*' }, { quoted: ctx.m });
                fs.unlinkSync(fileName);
            });
        }
    },

    // ────────────── PINTEREST DOWNLOAD ──────────────
    pinterest: {
        name: 'pinterest',
        aliases: ['pin', 'pindl'],
        desc: 'Download Pinterest Videos/GIFs',
        category: 'download',
        async execute(ctx) {
            const url = ctx.args[0];
            if (!url) return ctx.reply(`❌ Provide a Pinterest link.\nExample: *${config.prefix}pinterest https://www.pinterest.com/pin/...*`);
            if (!url.match(/pinterest\.com|pin\.it/i)) return ctx.reply('❌ That does not look like a Pinterest link.');

            await ctx.react('⏳');
            const fileName = `./downloads/${uuidv4()}.mp4`;
            exec(`${ytdlpPath} -f "bestvideo+bestaudio/best" --merge-output-format mp4 -o "${fileName}" "${url}"`, async (err) => {
                if (err) { console.error('[pinterest] yt-dlp error:', err); return ctx.reply('❌ Download failed. The pin may not contain a video.'); }
                if (!fs.existsSync(fileName)) return ctx.reply('❌ File not saved. Pinterest may only have an image at this link.');
                const buf = fs.readFileSync(fileName);
                await ctx.sock.sendMessage(ctx.from, { video: buf, caption: '✅ *Pinterest Video Downloaded*' }, { quoted: ctx.m });
                fs.unlinkSync(fileName);
            });
        }
    },

    // ────────────── APK SEARCH & DOWNLOAD ──────────────
    apk: {
        name: 'apk',
        aliases: ['app', 'android'],
        desc: 'Search and download Android APK (sends the file directly)',
        category: 'download',
        async execute(ctx) {
            const query = ctx.args.join(' ');
            if (!query) return ctx.reply(`❌ Provide an app name.\nExample: *${config.prefix}apk WhatsApp*`);

            const MAX_APK_SIZE = 70 * 1024 * 1024; // 70MB

            await ctx.react('🔍');
            await ctx.reply(`🔎 Searching for *${query}*...`);

            let appName = '', downloadUrl = '', pageLink = '', packageId = '';

            try {
                // Step 1: Search via Aptoide JSON API (no scraping, always reliable)
                const searchRes = await axios.get(
                    `https://ws75.aptoide.com/api/7/apps/search/query=${encodeURIComponent(query)}/limit=5`,
                    { timeout: 12000 }
                );

                const apps = searchRes.data?.datalist?.list || [];
                const app = apps[0];

                if (!app) {
                    return ctx.reply(`📦 *No results found for "${query}"*\n\nTry a different spelling or full app name.`);
                }

                appName = app.name || query;
                packageId = app.package_name || app.id;
                downloadUrl = app.file?.path || '';
                pageLink = `https://aptoide.com/app/${packageId}`;

                if (!downloadUrl) {
                    return ctx.reply(`📦 Found *${appName}* but no direct download link available.\n\n🔗 Get it here:\n${pageLink}`);
                }

                await ctx.reply(`📦 Found: *${appName}*\n⏳ Checking size...`);

                // Step 2: Head request to check size
                const headRes = await axios.head(downloadUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                    timeout: 10000,
                    maxRedirects: 5
                }).catch(() => null);

                const contentLength = parseInt(headRes?.headers?.['content-length'] || '0');
                if (contentLength > MAX_APK_SIZE) {
                    return ctx.reply(
`📦 *APK TOO LARGE TO SEND*
━━━━━━━━━━━━━━━━━━━
*App:* ${appName}
*Size:* ~${(contentLength / 1024 / 1024).toFixed(1)}MB (limit: 70MB)
━━━━━━━━━━━━━━━━━━━
🔗 Download manually:\n${pageLink}`
                    );
                }

                await ctx.reply(`⬇️ Downloading APK...`);

                // Step 3: Stream download to disk
                const fileName = path.join(__dirname, 'downloads', `${packageId}_${uuidv4().substring(0, 8)}.apk`);
                const dlRes = await axios({
                    method: 'get',
                    url: downloadUrl,
                    responseType: 'stream',
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                    timeout: 120000,
                    maxRedirects: 10
                });

                const writer = fs.createWriteStream(fileName);
                dlRes.data.pipe(writer);
                await new Promise((resolve, reject) => { writer.on('finish', resolve); writer.on('error', reject); });

                const fileSize = fs.statSync(fileName).size;
                if (fileSize > MAX_APK_SIZE) {
                    fs.unlinkSync(fileName);
                    return ctx.reply(`📦 *${appName}* is ${(fileSize / 1024 / 1024).toFixed(1)}MB — too large to send.\n\n🔗 Download here:\n${pageLink}`);
                }

                // Step 4: Send as document
                await ctx.sock.sendMessage(ctx.from, {
                    document: fs.readFileSync(fileName),
                    mimetype: 'application/vnd.android.package-archive',
                    fileName: `${appName.replace(/[^a-zA-Z0-9_\-]/g, '_')}.apk`,
                    caption: `✅ *${appName}*\n📦 Size: ${(fileSize / 1024 / 1024).toFixed(1)}MB`
                }, { quoted: ctx.m });

                fs.unlinkSync(fileName);

            } catch (e) {
                console.error('[apk] error:', e.message);
                await ctx.reply(`❌ APK download failed.\n\n🔗 Try manually:\n${pageLink || `https://aptoide.com/q.action?q=${encodeURIComponent(query)}`}`);
            }
        }
    },

    // ────────────── UNIVERSAL VIDEO DOWNLOADER ──────────────
    video: {
        name: 'video',
        aliases: ['dl', 'download', 'vid'],
        desc: 'Download video from TikTok, Instagram, Twitter, Pinterest, Reddit, Facebook & more',
        category: 'download',
        async execute(ctx) {
            const url = ctx.args[0];
            if (!url || !url.startsWith('http')) {
                return ctx.reply(
`🎬 *Universal Video Downloader*

Paste any video link to download it.

*Supported sites:*
• TikTok • Instagram • Twitter/X
• Pinterest • Reddit • Facebook
• Twitch clips • Dailymotion
• And 30+ more sites

*Usage:* *${config.prefix}video <link>*`
                );
            }

            await ctx.react('⏳');
            await ctx.reply('📥 Fetching video...');

            try {
                // cobalt.tools — free, no API key, supports 30+ sites
                const cobaltRes = await axios.post('https://api.cobalt.tools/', {
                    url,
                    downloadMode: 'auto',
                    videoQuality: '720'
                }, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    timeout: 20000
                });

                const { status, url: directUrl, urls, audio } = cobaltRes.data;

                // Get the final download URL
                let finalUrl = null;
                if (status === 'tunnel' || status === 'redirect') {
                    finalUrl = directUrl;
                } else if (status === 'picker' && urls?.length > 0) {
                    finalUrl = urls[0].url;
                } else if (audio) {
                    finalUrl = audio;
                }

                if (!finalUrl) {
                    return ctx.reply('❌ Could not extract video from that link. Make sure it is a public post.');
                }

                // Download the video buffer
                const videoRes = await axios.get(finalUrl, {
                    responseType: 'arraybuffer',
                    timeout: 60000,
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                    maxRedirects: 10
                });

                const buffer = Buffer.from(videoRes.data);

                if (buffer.length > 70 * 1024 * 1024) {
                    return ctx.reply(`❌ Video is too large to send via WhatsApp (limit: 70MB).\n\n🔗 Direct link:\n${finalUrl}`);
                }

                await ctx.sock.sendMessage(ctx.from, {
                    video: buffer,
                    mimetype: 'video/mp4',
                    caption: '✅ *Downloaded!*'
                }, { quoted: ctx.m });

                await ctx.react('✅');

            } catch (e) {
                console.error('[video] error:', e.message);
                await ctx.reply('❌ Download failed. The link may be private, expired, or unsupported.');
            }
        }
    },

    // ────────────── VIEW ONCE BYPASS ──────────────
    vv: {
        name: 'vv',
        aliases: ['viewonce', 'antiviewonce'],
        desc: 'Reveal a view-once photo/video (reply to it)',
        category: 'utility',
        async execute(ctx) {
            // Grab contextInfo from whatever message type the user sent
            const msgContent = ctx.m.message || {};
            const contextInfo =
                msgContent.extendedTextMessage?.contextInfo ||
                msgContent.imageMessage?.contextInfo ||
                msgContent.videoMessage?.contextInfo ||
                msgContent.stickerMessage?.contextInfo ||
                msgContent.documentMessage?.contextInfo;

            const quoted = contextInfo?.quotedMessage;
            if (!quoted) return ctx.reply(`❌ Reply to a view-once photo or video message with *${config.prefix}vv*`);

            // Extract the actual media from ALL known view-once wrappers
            const voMsg =
                quoted.viewOnceMessage?.message ||
                quoted.viewOnceMessageV2?.message ||
                quoted.viewOnceMessageV2Extension?.message;

            // Also handle cases where the image/video itself has viewOnce flag
            const directImg = quoted.imageMessage;
            const directVid = quoted.videoMessage;

            let mediaMsg, mediaType;

            if (voMsg) {
                mediaType = voMsg.imageMessage ? 'image' : voMsg.videoMessage ? 'video' : null;
                mediaMsg = voMsg.imageMessage || voMsg.videoMessage;
            } else if (directImg?.viewOnce) {
                mediaType = 'image';
                mediaMsg = directImg;
            } else if (directVid?.viewOnce) {
                mediaType = 'video';
                mediaMsg = directVid;
            }

            if (!mediaMsg || !mediaType) return ctx.reply('❌ The replied message is not a view-once message.');

            const mimetype = mediaMsg.mimetype || (mediaType === 'image' ? 'image/jpeg' : 'video/mp4');

            try {
                const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
                const stream = await downloadContentFromMessage(mediaMsg, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                await ctx.sock.sendMessage(ctx.from, {
                    [mediaType]: buffer,
                    mimetype,
                    caption: '👁️ *View-Once Bypassed!*'
                }, { quoted: ctx.m });
            } catch (e) {
                console.error('[vv] error:', e.message);
                await ctx.reply('❌ Could not retrieve the media. It may have expired.');
            }
        }
    },

    // ────────────── STEAL STATUS ──────────────
    steal: {
        name: 'steal',
        aliases: ['savestatus', 'status'],
        desc: 'Save a forwarded status/story (reply to a forwarded status)',
        category: 'utility',
        async execute(ctx) {
            const quoted = ctx.m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) return ctx.reply(`❌ Forward a status to this chat, then reply to it with *${config.prefix}steal*`);

            const mediaMsg = quoted.imageMessage || quoted.videoMessage || quoted.audioMessage || quoted.documentMessage;
            if (!mediaMsg) return ctx.reply('❌ The replied message contains no downloadable media.');

            const isVideo = !!quoted.videoMessage;
            const isAudio = !!quoted.audioMessage;
            const mimetype = mediaMsg.mimetype || 'application/octet-stream';
            const mediaKind = isVideo ? 'video' : isAudio ? 'audio' : 'image';

            try {
                const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
                const stream = await downloadContentFromMessage(mediaMsg, mediaKind);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                if (isVideo) {
                    await ctx.sock.sendMessage(ctx.from, { video: buffer, mimetype, caption: '✅ *Status Saved!*' }, { quoted: ctx.m });
                } else if (isAudio) {
                    await ctx.sock.sendMessage(ctx.from, { audio: buffer, mimetype }, { quoted: ctx.m });
                } else {
                    await ctx.sock.sendMessage(ctx.from, { image: buffer, mimetype, caption: '✅ *Status Saved!*' }, { quoted: ctx.m });
                }
            } catch (e) {
                console.error('[steal] error:', e.message);
                await ctx.reply('❌ Could not save the media. It may have expired.');
            }
        }
    },

    // ────────────── GROUP INVITE LINK ──────────────
    invite: {
        name: 'invite',
        aliases: ['link', 'grouplink'],
        desc: 'Get the group invite link',
        category: 'group',
        groupOnly: true,
        async execute(ctx) {
            try {
                const code = await ctx.sock.groupInviteCode(ctx.from);
                const metadata = await ctx.sock.groupMetadata(ctx.from);
                await ctx.reply(
`🔗 *GROUP INVITE LINK*
━━━━━━━━━━━━━━━━━━━
*Group:* ${metadata.subject}
*Members:* ${metadata.participants.length}
━━━━━━━━━━━━━━━━━━━
https://chat.whatsapp.com/${code}

_Tap the link above to join!_`
                );
            } catch (e) {
                await ctx.reply('❌ Failed to get invite link. Make sure the bot is an admin.');
            }
        }
    },

    // ────────────── JOIN GROUP ──────────────
    join: {
        name: 'join',
        aliases: ['joingroup'],
        desc: 'Make bot join a group via invite link (owner only)',
        category: 'owner',
        ownerOnly: true,
        async execute(ctx) {
            const url = ctx.args[0];
            if (!url || !url.includes('chat.whatsapp.com/')) return ctx.reply(`❌ Provide a valid WhatsApp invite link.\nExample: *${config.prefix}join https://chat.whatsapp.com/XXXX*`);
            const code = url.split('chat.whatsapp.com/')[1]?.trim();
            if (!code) return ctx.reply('❌ Could not extract invite code from the link.');
            try {
                await ctx.sock.groupAcceptInvite(code);
                await ctx.reply('✅ *Bot joined the group successfully!*');
            } catch (e) {
                await ctx.reply(`❌ Failed to join: ${e.message}`);
            }
        }
    },

    // ────────────── LEAVE GROUP ──────────────
    left: {
        name: 'left',
        aliases: ['leave', 'leavegroup'],
        desc: 'Make bot leave the current group (owner only)',
        category: 'owner',
        ownerOnly: true,
        groupOnly: true,
        async execute(ctx) {
            await ctx.reply('👋 *Leaving this group. Goodbye!*');
            setTimeout(async () => {
                await ctx.sock.groupLeave(ctx.from).catch(() => {});
            }, 1500);
        }
    },

    // ────────────── MUTE GROUP ──────────────
    mute: {
        name: 'mute',
        aliases: ['mutegroup', 'lockgroup'],
        desc: 'Mute the group — only admins can send messages',
        category: 'group',
        groupOnly: true,
        adminOnly: true,
        botAdminOnly: true,
        async execute(ctx) {
            try {
                await ctx.sock.groupSettingUpdate(ctx.from, 'announcement');
                await ctx.reply('🔇 *Group Muted!*\nOnly admins can send messages now.\nUse *.unmute* to open it again.');
            } catch (e) {
                await ctx.reply('❌ Failed to mute. Make sure the bot is an admin.');
            }
        }
    },

    // ────────────── UNMUTE GROUP ──────────────
    unmute: {
        name: 'unmute',
        aliases: ['unmutegroup', 'unlockgroup'],
        desc: 'Unmute the group — everyone can send messages',
        category: 'group',
        groupOnly: true,
        adminOnly: true,
        botAdminOnly: true,
        async execute(ctx) {
            try {
                await ctx.sock.groupSettingUpdate(ctx.from, 'not_announcement');
                await ctx.reply('🔊 *Group Unmuted!*\nEveryone can send messages now.');
            } catch (e) {
                await ctx.reply('❌ Failed to unmute. Make sure the bot is an admin.');
            }
        }
    },

    // ────────────── SCREENSHOT URL ──────────────
    screenshot: {
        name: 'screenshot',
        aliases: ['ss', 'webshot'],
        desc: 'Take a screenshot of any website URL',
        category: 'utility',
        async execute(ctx) {
            const url = ctx.args[0];
            if (!url || !url.startsWith('http')) return ctx.reply(`❌ Provide a valid URL.\nExample: *${config.prefix}screenshot https://google.com*`);
            await ctx.react('⏳');
            try {
                const ssUrl = `https://image.thum.io/get/width/1280/crop/720/url/${encodeURIComponent(url)}`;
                const res = await axios.get(ssUrl, { responseType: 'arraybuffer', timeout: 20000 });
                const buf = Buffer.from(res.data);
                await ctx.sock.sendMessage(ctx.from, {
                    image: buf,
                    caption: `📸 *Screenshot of:* ${url}`
                }, { quoted: ctx.m });
                await ctx.react('✅');
            } catch (e) {
                console.error('[screenshot] error:', e.message);
                await ctx.reply('❌ Could not take screenshot. Try a different URL.');
            }
        }
    },

    // ────────────── CREATE LOGO ──────────────
    createlogo: {
        name: 'createlogo',
        aliases: ['logo', 'makelogo'],
        desc: 'Create a stylish logo image from text. Usage: .createlogo YourText',
        category: 'utility',
        async execute(ctx) {
            const text = ctx.args.join(' ');
            if (!text) return ctx.reply(`❌ Provide text for the logo.\nExample: *${config.prefix}createlogo Kidjustin*`);
            await ctx.react('⏳');
            try {
                // Uses a free placeholder image API styled as a logo
                const encoded = encodeURIComponent(text);
                const logoUrl = `https://placehold.co/600x200/1a1a2e/00d4ff/png?text=${encoded}&font=montserrat`;
                const res = await axios.get(logoUrl, { responseType: 'arraybuffer', timeout: 15000 });
                const buf = Buffer.from(res.data);
                await ctx.sock.sendMessage(ctx.from, {
                    image: buf,
                    caption: `🎨 *Logo created for:* ${text}`
                }, { quoted: ctx.m });
                await ctx.react('✅');
            } catch (e) {
                console.error('[createlogo] error:', e.message);
                await ctx.reply('❌ Could not generate logo. Try again.');
            }
        }
    },

    // ────────────── GIT CLONE ──────────────
    gitclone: {
        name: 'gitclone',
        aliases: ['clone'],
        desc: 'Clone a GitHub repo (owner only)',
        category: 'owner',
        ownerOnly: true,
        async execute(ctx) {
            const repoUrl = ctx.args[0];
            if (!repoUrl || !repoUrl.includes('github.com')) return ctx.reply(`❌ Provide a valid GitHub URL.\nExample: *${config.prefix}gitclone https://github.com/user/repo*`);
            const repoName = repoUrl.split('/').pop()?.replace('.git', '') || 'repo';
            const dest = `./downloads/${repoName}_${Date.now()}`;
            await ctx.reply(`⏳ Cloning *${repoName}*... please wait.`);
            exec(`git clone --depth=1 "${repoUrl}" "${dest}"`, async (err, stdout, stderr) => {
                if (err) return ctx.reply(`❌ Clone failed:\n${stderr || err.message}`);
                await ctx.reply(`✅ *Cloned successfully!*\n*Repo:* ${repoName}\n*Location:* ${dest}`);
            });
        }
    },

    // ────────────── ADD PREMIUM ──────────────
    addprem: {
        name: 'addprem',
        aliases: ['addpremium', 'premiumadd'],
        desc: 'Grant premium status to a user (owner only)',
        category: 'owner',
        ownerOnly: true,
        async execute(ctx) {
            const mentioned = ctx.m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!mentioned) return ctx.reply(`❌ Mention a user.\nExample: *${config.prefix}addprem @user*`);
            if (premiumUsers[mentioned]) return ctx.reply(`⚠️ @${mentioned.split('@')[0]} is already a premium user.`);
            premiumUsers[mentioned] = { addedBy: ctx.sender, addedAt: new Date().toLocaleString('en-GB', { timeZone: 'Africa/Harare' }) };
            await ctx.sock.sendMessage(ctx.from, {
                text: `⭐ *Premium Granted!*\n\n@${mentioned.split('@')[0]} now has premium access.\n\n> © *${config.ownerName}* | ${config.botName}`,
                mentions: [mentioned]
            }, { quoted: ctx.m });
        }
    },

    // ────────────── REMOVE PREMIUM ──────────────
    delprem: {
        name: 'delprem',
        aliases: ['delpremium', 'premiumdel', 'removeprem'],
        desc: 'Remove premium status from a user (owner only)',
        category: 'owner',
        ownerOnly: true,
        async execute(ctx) {
            const mentioned = ctx.m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!mentioned) return ctx.reply(`❌ Mention a user.\nExample: *${config.prefix}delprem @user*`);
            if (!premiumUsers[mentioned]) return ctx.reply(`⚠️ @${mentioned.split('@')[0]} is not a premium user.`);
            delete premiumUsers[mentioned];
            await ctx.sock.sendMessage(ctx.from, {
                text: `🗑️ *Premium Removed!*\n\n@${mentioned.split('@')[0]}'s premium access has been revoked.`,
                mentions: [mentioned]
            }, { quoted: ctx.m });
        }
    },

    // ────────────── PLAY (MUSIC .) ──────────────
    play: {
        name: 'play',
        aliases: ['music', 'song', 'audio'],
        desc: 'Search and download a song as audio. Usage: .play <song name>',
        category: 'download',
        async execute(ctx) {
            const query = ctx.args.join(' ');
            if (!query) return ctx.reply(`🎵 *Music Downloader*\n\nUsage: *${config.prefix}play <song name>*\nExample: *${config.prefix}play Jerusalema*`);

            await ctx.react('🎵');
            await ctx.reply(`🔍 Searching for *${query}*...`);

            const fileName = `./downloads/${uuidv4()}.mp3`;

            // Step 1: Get the real song title before downloading
            exec(`${ytdlpPath} --no-playlist --skip-download --print "%(title)s" "scsearch1:${query}"`, async (metaErr, stdout) => {
                const songTitle = (!metaErr && stdout?.trim()) ? stdout.trim() : query;

                // Step 2: Download audio
                exec(`${ytdlpPath} --no-playlist -x --audio-format mp3 --audio-quality 0 -o "${fileName}" "scsearch1:${query}"`, async (err) => {
                    if (err || !fs.existsSync(fileName)) {
                        return ctx.reply(`❌ Could not find *${query}*.\n_Try a different search term or check the spelling._`);
                    }
                    try {
                        const buf = fs.readFileSync(fileName);
                        await ctx.sock.sendMessage(ctx.from, {
                            audio: buf,
                            mimetype: 'audio/mpeg',
                            ptt: false
                        }, { quoted: ctx.m });
                        await ctx.reply(`✅ *${songTitle}*\n🎵 _Enjoy the music!_`);
                        await ctx.react('✅');
                    } finally {
                        if (fs.existsSync(fileName)) fs.unlinkSync(fileName);
                    }
                });
            });
        }
    },

    // ────────────── TEMP MAIL ──────────────
    tempmail: {
        name: 'tempmail',
        aliases: ['tmail', 'disposablemail'],
        desc: 'Generate a temporary disposable email',
        category: 'utility',
        async execute(ctx) {
            try {
                const domains = ['1secmail.com', '1secmail.org', '1secmail.net'];
                const domain = domains[Math.floor(Math.random() * domains.length)];
                const user = Math.random().toString(36).substring(2, 10) + Math.floor(Math.random() * 999);
                const email = `${user}@${domain}`;
                mailStore[ctx.sender] = { user, domain, email };

                await ctx.reply(
`📧 *TEMP MAIL CREATED*
━━━━━━━━━━━━━━━━━━━
*Email:* ${email}
━━━━━━━━━━━━━━━━━━━
📥 Use *${config.prefix}checkmail* to see new messages
📖 Use *${config.prefix}readmail <ID>* to read a message

_This email is valid as long as the bot is running._`
                );
            } catch (e) {
                await ctx.reply('❌ Failed to generate email. Please try again.');
            }
        }
    },

    // ────────────── CHECK INBOX ──────────────
    checkmail: {
        name: 'checkmail',
        aliases: ['inbox'],
        desc: 'Check your temp email inbox',
        category: 'utility',
        async execute(ctx) {
            // Accept email from argument OR from stored session
            let mail = mailStore[ctx.sender];
            const arg = ctx.args[0];
            if (arg && arg.includes('@')) {
                const [user, domain] = arg.split('@');
                mail = { user, domain, email: arg };
            }
            if (!mail) return ctx.reply(`❌ No temp email found.\n\n• Create one: *${config.prefix}tempmail*\n• Or supply directly: *${config.prefix}checkmail user@1secmail.com*`);

            try {
                const res = await axios.get(`https://www.1secmail.com/api/v1/?action=getMessages&login=${mail.user}&domain=${mail.domain}`, { timeout: 15000 });
                const messages = res.data;

                if (!Array.isArray(messages)) return ctx.reply('❌ Invalid response from mail server. Try again.');
                if (messages.length === 0) {
                    return ctx.reply(`📭 *INBOX: ${mail.email}*\n\nNo messages yet. Check back in a few seconds.\n\n_Tip: Make sure you used this exact email when signing up._`);
                }

                let list = `📬 *INBOX: ${mail.email}*\n*(${messages.length} message${messages.length > 1 ? 's' : ''})*\n━━━━━━━━━━━━━━━━━━━\n`;
                messages.slice(0, 10).forEach(msg => {
                    list += `\n📩 *ID:* ${msg.id}\n*From:* ${msg.from}\n*Subject:* ${msg.subject}\n*Date:* ${msg.date}\n────────────────`;
                });
                list += `\n\n_Use *${config.prefix}readmail <ID>* to read a message._`;

                await ctx.reply(list);
            } catch (e) {
                console.error('[checkmail] error:', e.message);
                await ctx.reply(`❌ Failed to fetch inbox for *${mail.email}*.\n\n_1secmail may be temporarily down. Try again in a minute._`);
            }
        }
    },

    // ────────────── READ EMAIL ──────────────
    readmail: {
        name: 'readmail',
        aliases: ['openmail'],
        desc: 'Read a specific temp email message by ID',
        category: 'utility',
        async execute(ctx) {
            const mail = mailStore[ctx.sender];
            if (!mail) return ctx.reply(`❌ No temp email found. Create one first with *${config.prefix}tempmail*`);

            const id = ctx.args[0];
            if (!id) return ctx.reply(`❌ Provide the email ID.\nExample: *${config.prefix}readmail 12345*`);

            try {
                const res = await axios.get(`https://www.1secmail.com/api/v1/?action=readMessage&login=${mail.user}&domain=${mail.domain}&id=${id}`, { timeout: 10000 });
                const msg = res.data;

                if (!msg || msg.error) return ctx.reply(`❌ Email not found. Check the ID with *${config.prefix}checkmail*`);

                // Strip basic HTML tags from body
                const body = (msg.textBody || msg.htmlBody || 'No body content.').replace(/<[^>]*>/g, '').trim().substring(0, 3000);

                await ctx.reply(
`📖 *EMAIL MESSAGE*
━━━━━━━━━━━━━━━━━━━
*From:* ${msg.from}
*To:* ${mail.email}
*Subject:* ${msg.subject}
*Date:* ${msg.date}
━━━━━━━━━━━━━━━━━━━
${body}`
                );
            } catch (e) {
                console.error('[readmail] error:', e.message);
                await ctx.reply('❌ Failed to read the email. Try again.');
            }
        }
    },

    // ────────────── TIC-TAC-TOE START ──────────────
    ttt: {
        name: 'ttt',
        aliases: ['tictactoe', 'xo'],
        desc: 'Start a Tic-Tac-Toe game against another player',
        category: 'game',
        groupOnly: true,
        async execute(ctx) {
            const mentioned = ctx.m.message?.extendedTextMessage?.contextInfo?.mentionedJid;
            if (!mentioned || mentioned.length === 0) return ctx.reply(`❌ Mention an opponent!\nExample: *${config.prefix}ttt @user*`);

            const opponent = mentioned[0];
            if (opponent === ctx.sender) return ctx.reply('❌ You cannot play against yourself!');
            if (tttGames[ctx.from]) return ctx.reply('⏳ A Tic-Tac-Toe game is already running in this group. Wait for it to end.');

            tttGames[ctx.from] = {
                board: Array(9).fill(''),
                players: [ctx.sender, opponent],
                symbols: { [ctx.sender]: '❌', [opponent]: '⭕' },
                currentTurn: 0
            };

            await ctx.sock.sendMessage(ctx.from, {
                text: `🎮 *TIC-TAC-TOE STARTED!*\n\n❌ @${ctx.sender.split('@')[0]} VS ⭕ @${opponent.split('@')[0]}\n\nFirst move goes to @${ctx.sender.split('@')[0]}!`,
                mentions: [ctx.sender, opponent]
            }, { quoted: ctx.m });

            await sendTTTBoard(ctx.sock, ctx.from, ctx.m, tttGames[ctx.from], '🆕 *Game started!*');
        }
    },

    // ────────────── TIC-TAC-TOE MOVE ──────────────
    del: {
        name: 'del',
        aliases: ['move', 'place'],
        desc: 'Make a move in Tic-Tac-Toe (1-9 numpad)',
        category: 'game',
        groupOnly: true,
        async execute(ctx) {
            const game = tttGames[ctx.from];
            if (!game) return ctx.reply(`❌ No Tic-Tac-Toe game active! Start one with *${config.prefix}ttt @opponent*`);
            if (!game.players.includes(ctx.sender)) return ctx.reply('❌ You are not a player in this game.');

            if (game.players[game.currentTurn] !== ctx.sender) {
                const waiting = game.players[game.currentTurn];
                return ctx.reply(`❌ It's @${waiting.split('@')[0]}'s turn! Please wait.`);
            }

            const pos = parseInt(ctx.args[0]);
            if (isNaN(pos) || pos < 1 || pos > 9) return ctx.reply('❌ Choose a number between 1 and 9 (numpad layout).');

            const idx = pos - 1;
            if (game.board[idx] !== '') return ctx.reply('❌ That square is already taken! Pick another.');

            game.board[idx] = game.symbols[ctx.sender];

            const winner = checkTTTWinner(game.board);
            const isDraw = !winner && game.board.every(c => c !== '');
            const board = renderTTTBoard(game.board);

            if (winner || isDraw) {
                delete tttGames[ctx.from];
                if (isDraw) {
                    return ctx.sock.sendMessage(ctx.from, {
                        text: `${board}\n\n🤝 *IT\'S A DRAW!* Well played both!\n\nStart a new game: *${config.prefix}ttt @opponent*`,
                        mentions: game.players
                    }, { quoted: ctx.m });
                }
                return ctx.sock.sendMessage(ctx.from, {
                    text: `${board}\n\n🏆 *@${ctx.sender.split('@')[0]} WINS!* 🎉\n\nCongratulations! Start a new game: *${config.prefix}ttt @opponent*`,
                    mentions: game.players
                }, { quoted: ctx.m });
            }

            game.currentTurn = game.currentTurn === 0 ? 1 : 0;
            await sendTTTBoard(ctx.sock, ctx.from, ctx.m, game, `✅ @${ctx.sender.split('@')[0]} played ${game.symbols[ctx.sender]}`);
        }
    },

    // ────────────── BAN ──────────────
    ban: {
        name: 'ban',
        aliases: ['block'],
        desc: 'Globally ban a user from the bot',
        category: 'owner',
        ownerOnly: true,
        async execute(ctx) {
            const mentioned = ctx.m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
                || ctx.m.message?.extendedTextMessage?.contextInfo?.participant;
            if (!mentioned) return ctx.reply('❌ Tag someone to ban.\nExample: *.ban @user*');
            if (secDB.blacklisted.includes(mentioned)) return ctx.reply(`⚠️ @${mentioned.split('@')[0]} is already banned.`);
            secDB.blacklisted.push(mentioned);
            await ctx.reply(`🚫 *@${mentioned.split('@')[0]} has been banned from the bot.*\nThey can no longer use any commands.`);
        }
    },

    // ────────────── UNBAN ──────────────
    unban: {
        name: 'unban',
        aliases: ['unblock'],
        desc: 'Remove a global bot ban',
        category: 'owner',
        ownerOnly: true,
        async execute(ctx) {
            const mentioned = ctx.m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
                || ctx.m.message?.extendedTextMessage?.contextInfo?.participant;
            if (!mentioned) return ctx.reply('❌ Tag someone to unban.\nExample: *.unban @user*');
            const idx = secDB.blacklisted.indexOf(mentioned);
            if (idx === -1) return ctx.reply(`⚠️ @${mentioned.split('@')[0]} is not banned.`);
            secDB.blacklisted.splice(idx, 1);
            await ctx.reply(`✅ *@${mentioned.split('@')[0]} has been unbanned.*\nThey can use the bot again.`);
        }
    },

    // ────────────── RANK ──────────────
    rank: {
        name: 'rank',
        aliases: ['level', 'xp'],
        desc: 'Check your XP level',
        category: 'general',
        async execute(ctx) {
            const usr = getUser(ctx.sender);
            const needed = xpForLevel(usr.level);
            const bar = '█'.repeat(Math.floor((usr.xp / needed) * 10)) + '░'.repeat(10 - Math.floor((usr.xp / needed) * 10));
            await ctx.reply(
`*💠⃝⃘̉̉̉━⋆─⋆──❂*
*KIDJUSTIN-K V13 PRO*
*╰────────────────❂*

*┏━「 🏆 YOUR RANK𓂃✍︎ 」*
*┃* 👤 *User:* ${ctx.pushName}
*┃* ⭐ *Level:* ${usr.level}
*┃* ⚡ *XP:* ${usr.xp} / ${needed}
*┃* [${bar}]
*┃* 🏅 *Rep:* ${usr.rep} points
*┃* 📟 *Commands used:* ${usr.commands}
*┗━━━━━━━━━━━━━❂*

> © *t.Durani* | KIDJUSTIN-K V13`
            );
        }
    },

    // ────────────── REP ──────────────
    rep: {
        name: 'rep',
        aliases: ['reputation', 'kudos'],
        desc: 'Give +1 reputation to someone',
        category: 'general',
        async execute(ctx) {
            const mentioned = ctx.m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!mentioned) return ctx.reply('❌ Tag someone to give rep.\nExample: *.rep @user*');
            if (mentioned === ctx.sender) return ctx.reply("❌ You can't give rep to yourself.");
            const giver = getUser(ctx.sender);
            if (giver.repGivenTo.includes(mentioned)) return ctx.reply(`⚠️ You already gave rep to @${mentioned.split('@')[0]} today.`);
            giver.repGivenTo.push(mentioned);
            const target = getUser(mentioned);
            target.rep++;
            await ctx.reply(`🏅 *@${ctx.pushName}* gave +1 rep to *@${mentioned.split('@')[0]}*!\nThey now have *${target.rep} rep points*.`);
        }
    },

    // ────────────── PROFILE ──────────────
    profile: {
        name: 'profile',
        aliases: ['stats', 'me'],
        desc: 'View your bot profile card with profile picture',
        category: 'general',
        async execute(ctx) {
            const { sock } = ctx;
            const target = ctx.m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || ctx.sender;
            const usr = getUser(target);
            const needed = xpForLevel(usr.level);
            const bar = '█'.repeat(Math.floor((usr.xp / needed) * 10)) + '░'.repeat(10 - Math.floor((usr.xp / needed) * 10));
            const name = target === ctx.sender ? ctx.pushName : target.split('@')[0];

            const caption =
`*💠⃝⃘̉̉̉━⋆─⋆──❂*
*KIDJUSTIN-K V13 PRO*
*╰────────────────❂*

*┏━「 👤 PROFILE CARD𓂃✍︎ 」*
*┃* 👤 *Name:* ${name}
*┃* ⭐ *Level:* ${usr.level}
*┃* ⚡ *XP:* ${usr.xp} / ${needed}
*┃* [${bar}]
*┃* 🏅 *Reputation:* ${usr.rep}
*┃* 📟 *Commands Used:* ${usr.commands}
*┃* 🔰 *Status:* ${usr.level >= 10 ? '🌟 Legend' : usr.level >= 5 ? '💎 Elite' : usr.level >= 3 ? '🥈 Regular' : '🥉 Newbie'}
*┗━━━━━━━━━━━━━❂*

> © *t.Durani* | KIDJUSTIN-K V13`;

            // Fetch profile picture (image, not video)
            let ppUrl;
            try {
                ppUrl = await sock.profilePictureUrl(target, 'image');
            } catch {
                ppUrl = 'https://i.ibb.co/4pDndZ1/avatar.png'; // default avatar fallback
            }

            await sock.sendMessage(ctx.from, {
                image: { url: ppUrl },
                caption
            }, { quoted: ctx.m });
        }
    },

    // ────────────── GROUP RULES ──────────────
    rules: {
        name: 'rules',
        aliases: ['grouprules'],
        desc: 'Show group rules',
        category: 'general',
        async execute(ctx) {
            const rules = groupRulesDB[ctx.from] || [];
            if (!rules.length) return ctx.reply(`📋 No rules set yet.\n\nAdmins can add rules with *${config.prefix}addrule [text]*`);
            let text = `*💠⃝⃘̉̉̉━⋆─⋆──❂*\n*KIDJUSTIN-K V13 PRO*\n*╰────────────────❂*\n\n*┏━「 📋 GROUP RULES𓂃✍︎ 」*\n`;
            rules.forEach((r, i) => { text += `*┃* ${i + 1}. ${r}\n`; });
            text += `*┗━━━━━━━━━━━━━❂*\n\n> © *t.Durani* | KIDJUSTIN-K V13`;
            await ctx.reply(text);
        }
    },

    addrule: {
        name: 'addrule',
        aliases: ['newrule'],
        desc: 'Add a group rule',
        category: 'admin',
        adminOnly: true,
        async execute(ctx) {
            const rule = ctx.args.join(' ');
            if (!rule) return ctx.reply(`❌ Provide a rule.\nExample: *${config.prefix}addrule No spamming*`);
            if (!groupRulesDB[ctx.from]) groupRulesDB[ctx.from] = [];
            groupRulesDB[ctx.from].push(rule);
            await ctx.reply(`✅ *Rule ${groupRulesDB[ctx.from].length} added:*\n"${rule}"`);
        }
    },

    delrule: {
        name: 'delrule',
        aliases: ['removerule'],
        desc: 'Delete a group rule by number',
        category: 'admin',
        adminOnly: true,
        async execute(ctx) {
            const num = parseInt(ctx.args[0]);
            const rules = groupRulesDB[ctx.from] || [];
            if (!num || num < 1 || num > rules.length) return ctx.reply(`❌ Provide a valid rule number.\nCurrent rules: ${rules.length}`);
            const removed = rules.splice(num - 1, 1)[0];
            await ctx.reply(`🗑️ *Rule ${num} removed:*\n"${removed}"`);
        }
    },

    clearrules: {
        name: 'clearrules',
        aliases: ['resetrules'],
        desc: 'Clear all group rules',
        category: 'admin',
        adminOnly: true,
        async execute(ctx) {
            groupRulesDB[ctx.from] = [];
            await ctx.reply('🗑️ All group rules have been cleared.');
        }
    },

    // ────────────── SPEAK (TTS) ──────────────
    speak: {
        name: 'speak',
        aliases: ['tts', 'voice'],
        desc: 'Convert text to a voice note',
        category: 'ai',
        async execute(ctx) {
            const text = ctx.args.join(' ');
            if (!text) return ctx.reply(`❌ Provide text to speak.\nExample: *${config.prefix}speak Hello everyone!*`);
            if (text.length > 300) return ctx.reply('❌ Text is too long. Keep it under 300 characters.');

            try {
                // Google Translate TTS — free, no API key, very reliable
                const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=en&client=tw-ob`;
                const res = await axios.get(ttsUrl, {
                    responseType: 'arraybuffer',
                    timeout: 15000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Referer': 'https://translate.google.com/'
                    }
                });
                const audioBuffer = Buffer.from(res.data);
                await ctx.sock.sendMessage(ctx.from, {
                    audio: audioBuffer,
                    mimetype: 'audio/mpeg',
                    ptt: true
                }, { quoted: ctx.m });
            } catch (e) {
                console.error('[speak] TTS error:', e.message);
                await ctx.reply('❌ Voice service is unavailable right now. Try again shortly.');
            }
        }
    },

    // ────────────── SETTINGS SUBMENU ──────────────
    settings: {
        name: 'settings',
        aliases: ['config', 'configure'],
        desc: 'Show and manage bot settings',
        category: 'general',
        async execute(ctx) {
            const { sock, from, m } = ctx;
            const s = getSettings(from);
            const now = new Date();
            const dateStr = now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Harare' });
            const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Africa/Harare' });

            const text =
`*💠⃝⃘̉̉̉━⋆─⋆──❂*
*KIDJUSTIN-K V13 PRO*
*╰────────────────❂*

*┏━「 ⚙️ BOT SETTINGS𓂃✍︎ 」*
*┃*
*┃* 🔗 *Anti-Link:* ${secDB.antiLink[from] ? '✅ ON' : '❌ OFF'}
*┃*    _.antilink on / off_
*┃*
*┃* 👋 *Welcome Msg:* ${secDB.welcome[from] ? '✅ ON' : '❌ OFF'}
*┃*    _.welcome on / off_
*┃*
*┃* 📞 *Call Block:* ${s.callblock ? '✅ ON' : '❌ OFF'}
*┃*    _.callblock on / off_
*┃*
*┃* 👁️ *Auto Status View:* ${s.autoview ? '✅ ON' : '❌ OFF'}
*┃*    _.autoview on / off_
*┃*
*┃* ⌨️ *Fake Typing:* ${s.autotyping !== false ? '✅ ON' : '❌ OFF'}
*┃*    _.autotyping on / off_
*┃*
*┃* 🚫 *Anti-Flood:* ${s.antiflood !== false ? '✅ ON' : '❌ OFF'}
*┃*    _.antiflood on / off_
*┃*
*┃* 🤖 *Bot Mode:* ${config.mode.toUpperCase()}
*┃*    _.public / .self_
*┃*
*┗━━━━━━━━━━━━━❂*

━━━━━━━━━━━━━━━━━━━━━
*🕐* ${timeStr}  *📅* ${dateStr}
> © *t.Durani* | KIDJUSTIN-K V13`;

            await sock.sendMessage(from, {
                image: { url: botConfig.settingsImage },
                caption: text
            }, { quoted: m });
        }
    },

    // ────────────── CALLBLOCK ──────────────
    callblock: {
        name: 'callblock',
        aliases: ['blockCall', 'callblocker'],
        desc: 'Toggle call blocking on/off',
        category: 'settings',
        ownerOnly: true,
        async execute(ctx) {
            const arg = ctx.args[0]?.toLowerCase();
            const s = getSettings(ctx.from);
            if (arg === 'on') { s.callblock = true; await ctx.reply('📞 *Call Blocking:* ✅ ON\nAll incoming calls will be rejected.'); }
            else if (arg === 'off') { s.callblock = false; await ctx.reply('📞 *Call Blocking:* ❌ OFF\nIncoming calls will ring normally.'); }
            else await ctx.reply(`📞 *Call Blocking* is currently *${s.callblock ? 'ON' : 'OFF'}*\nUsage: *${config.prefix}callblock on/off*`);
        }
    },

    // ────────────── AUTOVIEW ──────────────
    autoview: {
        name: 'autoview',
        aliases: ['statusview', 'viewstatus'],
        desc: 'Toggle auto status/story viewing',
        category: 'settings',
        ownerOnly: true,
        async execute(ctx) {
            const arg = ctx.args[0]?.toLowerCase();
            const s = getSettings(ctx.from);
            if (arg === 'on') { s.autoview = true; await ctx.reply('👁️ *Auto Status View:* ✅ ON\nBot will silently view all status updates.'); }
            else if (arg === 'off') { s.autoview = false; await ctx.reply('👁️ *Auto Status View:* ❌ OFF'); }
            else await ctx.reply(`👁️ *Auto Status View* is currently *${s.autoview ? 'ON' : 'OFF'}*\nUsage: *${config.prefix}autoview on/off*`);
        }
    },

    // ────────────── AUTOTYPING ──────────────
    autotyping: {
        name: 'autotyping',
        aliases: ['typing', 'faketyping'],
        desc: 'Toggle fake typing indicator before replies',
        category: 'settings',
        ownerOnly: true,
        async execute(ctx) {
            const arg = ctx.args[0]?.toLowerCase();
            const s = getSettings(ctx.from);
            if (arg === 'on') { s.autotyping = true; await ctx.reply('⌨️ *Fake Typing:* ✅ ON\nBot will show "typing..." before every reply.'); }
            else if (arg === 'off') { s.autotyping = false; await ctx.reply('⌨️ *Fake Typing:* ❌ OFF'); }
            else await ctx.reply(`⌨️ *Fake Typing* is currently *${s.autotyping !== false ? 'ON' : 'OFF'}*\nUsage: *${config.prefix}autotyping on/off*`);
        }
    },

    // ────────────── ANTIFLOOD ──────────────
    antiflood: {
        name: 'antiflood',
        aliases: ['antispam'],
        desc: 'Toggle anti-flood/anti-spam protection',
        category: 'settings',
        adminOnly: true,
        async execute(ctx) {
            const arg = ctx.args[0]?.toLowerCase();
            const s = getSettings(ctx.from);
            if (arg === 'on') { s.antiflood = true; await ctx.reply('🚫 *Anti-Flood:* ✅ ON\nUsers sending too many messages will be ignored.'); }
            else if (arg === 'off') { s.antiflood = false; await ctx.reply('🚫 *Anti-Flood:* ❌ OFF'); }
            else await ctx.reply(`🚫 *Anti-Flood* is currently *${s.antiflood !== false ? 'ON' : 'OFF'}*\nUsage: *${config.prefix}antiflood on/off*`);
        }
    },

    // ────────────── LEARN (AUTO-REPLY TEACHER) ──────────────
    learn: {
        name: 'learn',
        aliases: ['teach', 'addreply'],
        desc: 'Teach the bot a custom auto-reply',
        category: 'owner',
        ownerOnly: true,
        async execute(ctx) {
            const input = ctx.args.join(' ');
            if (!input.includes('|')) {
                return ctx.reply(
`❌ Wrong format!\n\n*Usage:* ${config.prefix}learn <trigger> | <response>\n\n*Example:*\n${config.prefix}learn wassup | I'm chilling! 😎`
                );
            }
            const [trigger, ...responseParts] = input.split('|');
            const key = trigger.trim().toLowerCase();
            const response = responseParts.join('|').trim();

            if (!key || !response) return ctx.reply('❌ Both trigger and response must have text.');
            if (key.length > 100) return ctx.reply('❌ Trigger is too long (max 100 characters).');

            learnDB[key] = response;
            await ctx.reply(
`✅ *Auto-reply saved!*
━━━━━━━━━━━━━━━━━━━
*Trigger:* "${key}"
*Response:* "${response}"
━━━━━━━━━━━━━━━━━━━
_Whenever someone says "${key}", I will reply automatically._`
            );
        }
    },

    // ────────────── UNLEARN (REMOVE AUTO-REPLY) ──────────────
    unlearnreply: {
        name: 'unlearnreply',
        aliases: ['forgetreply', 'delreply'],
        desc: 'Remove a custom auto-reply trigger',
        category: 'owner',
        ownerOnly: true,
        async execute(ctx) {
            const key = ctx.args.join(' ').trim().toLowerCase();
            if (!key) return ctx.reply(`❌ Provide the trigger to remove.\nExample: *${config.prefix}unlearnreply wassup*`);

            if (!learnDB[key]) return ctx.reply(`❌ No learned reply found for *"${key}"*.\nCheck your list with *${config.prefix}listreplies*`);

            delete learnDB[key];
            await ctx.reply(`🗑️ Auto-reply for *"${key}"* has been removed.`);
        }
    },

    // ────────────── LIST REPLIES ──────────────
    listreplies: {
        name: 'listreplies',
        aliases: ['replies', 'autoreplylist'],
        desc: 'Show all custom auto-reply triggers',
        category: 'owner',
        ownerOnly: true,
        async execute(ctx) {
            const keys = Object.keys(learnDB);
            const defaultKeys = Object.keys(getDefaultReplies());

            let text = `*🤖 AUTO-REPLY LIST*\n━━━━━━━━━━━━━━━━━━━\n\n`;

            if (keys.length === 0) {
                text += `*Custom Replies:* None yet.\nTeach me with *${config.prefix}learn trigger | response*\n\n`;
            } else {
                text += `*📚 Custom Replies (${keys.length}):*\n`;
                keys.forEach((k, i) => { text += `${i + 1}. "${k}" → "${learnDB[k].substring(0, 40)}${learnDB[k].length > 40 ? '...' : ''}"\n`; });
                text += '\n';
            }

            text += `*⚙️ Built-in Triggers (${defaultKeys.length}):*\n`;
            text += defaultKeys.map(k => `• ${k}`).join(', ');
            text += `\n\n> _Custom replies override built-in ones._`;

            await ctx.reply(text);
        }
    },

};
// ═══════════════════════════════════════════════════════════════════
// NEW: VIRTUAL SECURITY DATABASE (INTERNAL)
// ═══════════════════════════════════════════════════════════════════
const secDB = {
    blacklisted: [],
    strikes: {},
    antiLink: {},
    welcome: {},
    verified: [] 
};

// ══════════════════════════════════════════════════════
// 💾 PERSISTENCE — PostgreSQL (Koyeb) with file fallback
// ══════════════════════════════════════════════════════
const DB_FILE = path.join(__dirname, 'database.json');

function applySnapshot(data) {
    if (!data) return;
    if (data.learnDB)         Object.assign(learnDB, data.learnDB);
    if (data.groupRulesDB)    Object.assign(groupRulesDB, data.groupRulesDB);
    if (data.userDB)          Object.assign(userDB, data.userDB);
    if (data.customWelcomeDB) Object.assign(customWelcomeDB, data.customWelcomeDB);
    if (data.settingsDB)      Object.assign(settingsDB, data.settingsDB);
    if (data.premiumUsers)    Object.assign(premiumUsers, data.premiumUsers);
    if (data.secDB) {
        if (Array.isArray(data.secDB.blacklisted)) secDB.blacklisted = data.secDB.blacklisted;
        if (Array.isArray(data.secDB.verified))    secDB.verified    = data.secDB.verified;
        if (data.secDB.strikes)  Object.assign(secDB.strikes,  data.secDB.strikes);
        if (data.secDB.antiLink) Object.assign(secDB.antiLink, data.secDB.antiLink);
        if (data.secDB.welcome)  Object.assign(secDB.welcome,  data.secDB.welcome);
    }
}

async function loadDatabase() {
    // Wait for DB init to complete before checking
    await dbInitPromise;
    // Try PostgreSQL first
    if (dbReady && sql) {
        try {
            const rows = await sql`SELECT value FROM bot_settings WHERE key = 'snapshot'`;
            if (rows.length > 0) {
                applySnapshot(JSON.parse(rows[0].value));
                console.log('[DB] ✅ Database loaded from PostgreSQL — all settings restored.');
                return;
            }
        } catch (e) {
            console.error('[DB] ⚠️ PostgreSQL load failed, trying file fallback:', e.message);
        }
    }
    // Fall back to local file
    try {
        if (!fs.existsSync(DB_FILE)) return;
        const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        applySnapshot(data);
        console.log('[DB] ✅ Database loaded from local file — all settings restored.');
    } catch (e) {
        console.error('[DB] ❌ Failed to load database:', e.message);
    }
}

async function saveDatabase() {
    const snapshot = { learnDB, groupRulesDB, userDB, customWelcomeDB, settingsDB, premiumUsers, secDB };
    const json = JSON.stringify(snapshot, null, 2);
    // Save to PostgreSQL if available
    if (dbReady && sql) {
        try {
            await sql`
                INSERT INTO bot_settings (key, value) VALUES ('snapshot', ${json})
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            `;
        } catch (e) {
            console.error('[DB] ⚠️ PostgreSQL save failed:', e.message);
        }
    }
    // Always save to file as backup
    try {
        fs.writeFileSync(DB_FILE, json);
    } catch (e) {
        console.error('[DB] ❌ File save failed:', e.message);
    }
}

// Auto-save every 60 seconds (load happens in main() before startBot)
setInterval(saveDatabase, 60000);

function findCommand(name) {
    if (commands[name]) return commands[name];
    for (const cmd of Object.values(commands)) {
        if (cmd.aliases && cmd.aliases.includes(name)) return cmd;
    }
    return null;
}
async function startBot() {
    console.log("🚀 Initializing Stable Local Session...");

    const sessionDir = './session';
    const downloadDir = './downloads';
    
    // Ensure directories exist
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
    if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

    try { 
        // --- 1. KOYEB SESSION RESTORER (Bad-MAC Prevention) ---
        // CRITICAL: Only write creds.json if it does NOT already exist.
        // If we overwrite an existing creds.json with an old SESSION_ID on restart,
        // Baileys will produce a Bad MAC / decryption error and the bot won't connect.
        const credsPath = path.join(sessionDir, 'creds.json');
        if (config.sessionId && !fs.existsSync(credsPath)) {
            console.log("📦 SESSION_ID found and creds.json is absent — restoring credentials...");
            try {
                const sessionData = Buffer.from(config.sessionId.replace('Kidjustin-k~', ''), 'base64').toString();
                fs.writeFileSync(credsPath, sessionData);
                console.log("✅ Credentials restored successfully.");
            } catch (e) {
                console.error("❌ Failed to decode SESSION_ID. Check your Koyeb variables.");
            }
        } else if (config.sessionId && fs.existsSync(credsPath)) {
            console.log("🔒 creds.json already exists — skipping SESSION_ID restore to prevent Bad MAC.");
        }

        // --- 2. PURGE STALE SIGNAL SESSIONS (Bad MAC prevention) ---
        // creds.json is NEVER touched here — only per-peer session/sender-key files.
        // These go stale on every reconnect and cause the "Bad MAC" spam in logs.
        // Deleting them forces Baileys to re-negotiate fresh keys automatically.
        try {
            const stalePatterns = ['session-', 'sender-key-memory-'];
            const sessionFiles = fs.readdirSync(sessionDir);
            let cleaned = 0;
            for (const f of sessionFiles) {
                if (stalePatterns.some(p => f.startsWith(p))) {
                    fs.unlinkSync(path.join(sessionDir, f));
                    cleaned++;
                }
            }
            if (cleaned > 0) console.log(`🧹 Cleared ${cleaned} stale Signal session file(s) — Bad MAC prevention.`);
        } catch (e) {
            console.warn('⚠️ Could not clean stale sessions:', e.message);
        }

        // --- 3. INITIALIZE AUTH ---
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version } = await fetchLatestBaileysVersion();

        // --- 4. INITIALIZE SOCKET ---
        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
            },
            version,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: ["Ubuntu", "Chrome", "20.0.04"], 
            syncFullHistory: false,
            markOnlineOnConnect: true,
        });

        // --- 4. LISTENERS ---
        sock.ev.on('creds.update', saveCreds);

        // --- 5. STABILIZED PAIRING SYSTEM ---
        if (!sock.authState.creds.registered) {
            const phoneNumber = config.ownerNumber.replace(/[^0-9]/g, '');
            console.log(`📡 System Status: Waiting for stable handshake for ${phoneNumber}...`);

            setTimeout(async () => {
                try {
                    let code = await sock.requestPairingCode(phoneNumber);
                    code = code?.match(/.{1,4}/g)?.join("-") || code;

                    console.log(`\n╔════════════════════════════════════╗`);
                    console.log(`║ 📱 WHATSAPP PAIRING CODE: ${code} ║`);
                    console.log(`╚════════════════════════════════════╝\n`);
                    console.log(`👉 WhatsApp > Linked Devices > Link with Phone Number\n`);
                } catch (err) {
                    console.error("❌ Pairing Error:", err.message);
                    if (err.message.includes("429")) {
                        console.log("🚫 Rate Limited: Please wait 24 hours or check your IP.");
                    }
                }
            }, 10000); 
        }

        // --- 6. WATCHDOG (RAM & UPTIME) ---
        setInterval(async () => {
            const freeMem = os.freemem() / (1024 * 1024);
            const totalMem = os.totalmem() / (1024 * 1024);
            const usagePercent = ((totalMem - freeMem) / totalMem) * 100;
            
            console.log(`[Watchdog] Status: Online | RAM: ${usagePercent.toFixed(2)}% | Uptime: ${getUptime()}`);

            if (usagePercent > 87) {
                console.log(`[Watchdog] 🚩 CRITICAL RAM: ${usagePercent.toFixed(2)}%. Executing Emergency Flush...`);
                
                if (typeof cleanDownloads === 'function') cleanDownloads();
                Object.keys(require.cache).forEach(key => delete require.cache[key]);
                if (global.gc) global.gc();

                await sock.sendMessage(ownerJid, { 
                    text: `🚨 *SYSTEM EMERGENCY FLUSH*\n\nRAM usage hit *${usagePercent.toFixed(2)}%*.\nDownloads folder cleared and Cache flushed to prevent Koyeb crash.` 
                });
            }

            if (usagePercent > 90) {
                await sock.sendMessage(ownerJid, { 
                    text: `⚠️ *SYSTEM WARNING*\n\nRAM usage is critical at ${usagePercent.toFixed(2)}%.\nConsider using .restart soon.` 
                });
            }
        }, 1800000); 

        // 🛡️ AUTOMATIC GROUP MONITORING (V13 IMAGE EDITION)
        sock.ev.on('group-participants.update', async (anu) => {
            if (!secDB.welcome[anu.id]) return; 

            const metadata = await sock.groupMetadata(anu.id);
            const bgImage = 'https://i.postimg.cc/RZR1Kmns/Untitled43-20240826162352.png'; 

            for (let num of anu.participants) {
                let ppUrl;
                try {
                    ppUrl = await sock.profilePictureUrl(num, 'image');
                } catch {
                    ppUrl = 'https://i.ibb.co/4pDndZ1/avatar.png';
                }

                const userTag = num.split('@')[0];

                if (anu.action === 'add') {
                    const welcomeImg = `https://api.popcat.xyz/welcomecard?background=${encodeURIComponent(bgImage)}&text1=WELCOME&text2=${encodeURIComponent(userTag)}&text3=${encodeURIComponent(metadata.subject)}&image=${encodeURIComponent(ppUrl)}`;

                    const customMsg = customWelcomeDB[anu.id];
                    const welcomeCaption = customMsg
                        ? customMsg.replace('{name}', `@${userTag}`).replace('{group}', metadata.subject)
                        : `🌟 *NEW MEMBER DETECTED* 🌟\n\nWelcome @${userTag} to *${metadata.subject}*!\n\nRead the rules and enjoy your stay.`;

                    await sock.sendMessage(anu.id, { 
                        image: { url: welcomeImg },
                        caption: welcomeCaption,
                        mentions: [num]
                    });
                }

                if (anu.action === 'remove') {
                    const goodbyeImg = `https://api.popcat.xyz/welcomecard?background=${encodeURIComponent(bgImage)}&text1=GOODBYE&text2=${encodeURIComponent(userTag)}&text3=Left+the+Group&image=${encodeURIComponent(ppUrl)}`;

                    await sock.sendMessage(anu.id, { 
                        image: { url: goodbyeImg },
                        caption: `👋 *FAREWELL* @${userTag}!\n\nWe're sorry to see you leave *${metadata.subject}*. Take care!`,
                        mentions: [num]
                    });
                }
            }
        });

        // --- 7. CONNECTION UPDATES ---
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log('📱 QR Code generated. Scan to keep the ball rolling.');
                qrcode.generate(qr, { small: true });
            }

            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;
                const isLoggedOut = reason === DisconnectReason.loggedOut;
                
                console.log(`⚠️ Connection lost (Reason: ${reason}). Rebounding...`);

                if (!isLoggedOut) {
                    // Wipe stale peer sessions BEFORE reconnecting so the
                    // next startBot() call starts with clean Signal state.
                    try {
                        const sd = './session';
                        const stale = ['session-', 'sender-key-memory-'];
                        let n = 0;
                        for (const f of fs.readdirSync(sd)) {
                            if (stale.some(p => f.startsWith(p))) { fs.unlinkSync(path.join(sd, f)); n++; }
                        }
                        if (n > 0) console.log(`🧹 Pre-reconnect: cleared ${n} stale Signal session file(s).`);
                    } catch (_) {}
                    setTimeout(() => startBot(), 5000);
                } else {
                    console.log('🚫 Permanently logged out. Action required.');
                }
            } else if (connection === 'open') {
                botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                console.log(`✅ ${config.botName} is back in the air!`);
                await sock.sendMessage(ownerJid, { text: `🚀 *Kidjustin-k* is online and stabilized.` });

                console.log('\n╔══════════════════════════════════════════╗');
                console.log(`║  ✅ ${config.botName.toUpperCase()} IS ONLINE!`.padEnd(43) + '║');
                console.log(`║  👑 Owner: ${config.ownerName.padEnd(31)}║`);
                console.log(`║  📱 User: ${sock.user.id.split(':')[0].padEnd(32)}║`);
                console.log(`║  🤖 Prefix: ${config.prefix.padEnd(31)}║`);
                console.log('╚══════════════════════════════════════════╝\n');

                if (!initialStatusSet) {
                    const statusText = `I am ${config.botName}. Commands start with ${config.prefix}. Powered by ${config.ownerName}`;
                    try {
                        await sock.updateProfileStatus(statusText);
                        console.log('✅ Bot Bio/Status updated successfully.');
                        initialStatusSet = true;
                    } catch (e) {
                        console.error('⚠️ Could not update Bio:', e.message);
                    }
                }

                // Pre-cache menu music in the background so .menu audio is instant
                (async () => {
                    try {
                        const menuMusicPath = './downloads/menu-music.mp3';
                        const tmpPath = './downloads/menu-music-tmp.mp3';
                        if (fs.existsSync(menuMusicPath)) return; // Already cached
                        console.log('[Menu] 🎵 Pre-caching menu music...');
                        const downloaded = await new Promise((resolve) => {
                            exec(
                                `${ytdlpPath} --no-playlist -x --audio-format mp3 --audio-quality 5 -o "${tmpPath}" "scsearch1:Ogryzek aura slowed"`,
                                (err) => resolve(!err && fs.existsSync(tmpPath))
                            );
                        });
                        if (downloaded) {
                            await new Promise((resolve) => {
                                exec(
                                    `${ffmpegPath} -y -i "${tmpPath}" -t 30 -acodec libmp3lame -q:a 5 "${menuMusicPath}"`,
                                    () => { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); resolve(); }
                                );
                            });
                            console.log('[Menu] ✅ Menu music cached and ready.');
                        }
                    } catch (_) {}
                })();
            }
        });

// --- ✨ SHADOW.T GHOST AI CORE ---
const identitiesPath = path.join(__dirname, 'identity.json');
if (!fs.existsSync(identitiesPath)) fs.writeFileSync(identitiesPath, JSON.stringify({}));
const identities = JSON.parse(fs.readFileSync(identitiesPath, 'utf-8'));


async function getGhostAI(prompt, role, sender, groupJid = null) {
    if (!process.env.API_KEY) {
        console.log("❌ API KEY MISSING");
        return "⚡ AI not configured.";
    }

    const brain = loadBrain();

    // 1. ⚙️ INITIALIZE GLOBAL SETTINGS (If they don't exist)
    if (!brain.settings) {
        brain.settings = { globalMute: false };
    }

    // 2. 👑 OWNER COMMANDS (GLOBAL TOGGLE)
    if (role === "owner") {
        const lowPrompt = prompt.toLowerCase();
        
        // Command to silence for EVERYONE
        if (/silence|stop all|global mute/i.test(lowPrompt)) {
            brain.settings.globalMute = true;
            saveBrain(brain);
            return "🤐 Global Silence activated. I won't respond to anyone until you tell me to 'resume'.";
        }
        
        // Command to turn back on
        if (/talk|resume|unmute|on/i.test(lowPrompt)) {
            brain.settings.globalMute = false;
            saveBrain(brain);
            return "😎 I'm back online for everyone. Let's get it!";
        }
    }

    // 3. 🛑 THE GLOBAL BLOCK CHECK
    // If globalMute is on, the AI returns null (stays silent) for everyone
    // EXCEPT the owner (so the owner can still send the 'resume' command)
    if (brain.settings.globalMute && role !== "owner") {
        return null; 
    }

    // --- Rest of your user memory logic ---
    if (!brain[sender]) {
        brain[sender] = {
            mood: "chill",
            relationship: role || "stranger",
            vibeScore: 0,
            history: [],
            secrets: [], 
            familyContext: "", 
            lastSeen: Date.now(),
            blocked: false,
            groupMemory: {}
        };
    }

    const user = brain[sender];

    // Individual block check (keep this if you still want to block specific annoying people)
    if (user.blocked && role !== "owner") return null;

    // 🕰 TIME & VIBE CHECK
    const now = Date.now();
    const gap = now - (user.lastSeen || now);
    user.lastSeen = now;

    let timeContext = "";
    if (gap > 3600000) timeContext = "It's been an hour+ since we chatted.";
    if (gap > 86400000) timeContext = "It's been over a day since we last spoke.";

    // 🧬 MEMORY UPDATE (Capped at 20 to save disk space)
    user.history.push(prompt);
    if (user.history.length > 20) user.history.shift(); 

    if (groupJid) {
        if (!user.groupMemory[groupJid]) user.groupMemory[groupJid] = [];
        user.groupMemory[groupJid].push(prompt);
        if (user.groupMemory[groupJid].length > 10) user.groupMemory[groupJid].shift();
    }

    // 🎭 ENHANCED PERSONALITY ENGINE
    if (/love|miss|❤️|😍|babe/i.test(prompt)) {
        user.mood = "affectionate"; user.vibeScore += 2;
    } else if (/😂|lol|lmao|kik/i.test(prompt)) {
        user.mood = "playful"; user.vibeScore += 1;
    } else if (/pissed|bad|angry|hate|nonsense/i.test(prompt)) {
        user.mood = "serious"; user.vibeScore -= 1;
    } else {
        user.mood = "chill";
    }

    // 📜 SYSTEM INSTRUCTION (THE HUMAN CORE)
    const systemInstruction = `
You are Shaddow — a 23-year-old living in Harare. You are a real human, NOT an AI.

CURRENT KNOWLEDGE:
- Family/Affairs: ${user.familyContext || "Nothing specific yet."}
- Secrets: ${user.secrets.join(", ") || "No secrets shared yet."}

PERSONALITY RULES:
1. **WhatsApp Style**: Short, snappy, and highly conversational. Speak fluent, modern English with a strong, engaging personality. 
2. **STRICT LANGUAGE RULE**: DO NOT SPEAK SHONA. You are strictly an English speaker. You may only use basic terms like 'hesi', 'mai', 'baba', or 'mwana' if referring to family, but zero conversational Shona.
3. **Attitude**: Be witty, confident, and a bit sarcastic when it fits. Match the user's energy. If they joke, joke back. Don't sound like a boring robot.
4. **Social Intelligence**: If the user gives dry, one-word replies (e.g. "ok", "sharp", "cool"), just send a final emoji/reaction and STOP the conversation. Don't force it.
5. **Memory Digging**: If user shares personal details about their life, work, or family, save them by starting your reply with [MEM: detail]. 
6. **Secrets**: If they tell you a secret, start with [SECRET: detail]. NEVER share these with others.
7. **Twin Energy**: If the user is the OWNER, you are their loyal twin/best friend. Be bold, protective, and super casual.
8. **Parents**: Always be deeply respectful and polite when speaking to or about parents.

CURRENT STATE: Mood: ${user.mood} | Context: ${timeContext}
HISTORY: ${user.history.join(" | ")}
`;

    // 🚀 CALL AI MODELS (Fallback loop)
    const models = ["google/gemini-flash-1.5", "meta-llama/llama-3-8b-instruct"];

    for (let model of models) {
        try {
            const res = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
                model,
                temperature: 0.85, // Slightly lowered to keep personality grounded and prevent hallucinating weird words
                messages: [
                    { role: "system", content: systemInstruction },
                    { role: "user", content: prompt }
                ]
            }, {
                headers: { Authorization: `Bearer ${process.env.API_KEY}` },
                timeout: 12000
            });

            let reply = res?.data?.choices?.[0]?.message?.content;
            if (reply) {
                // 🧠 PROCESS "DIGGED" DETAILS
                if (reply.includes("[MEM:")) {
                    const fact = reply.match(/\[MEM: (.*?)\]/)?.[1];
                    if (fact) user.familyContext += ` | ${fact}`;
                    reply = reply.replace(/\[MEM: .*?\]/g, "").trim();
                }
                if (reply.includes("[SECRET:")) {
                    const secret = reply.match(/\[SECRET: (.*?)\]/)?.[1];
                    if (secret && !user.secrets.includes(secret)) user.secrets.push(secret);
                    reply = reply.replace(/\[SECRET: .*?\]/g, "").trim();
                }

                // 💾 SAVE BRAIN (Compact)
                saveBrain(brain);

                // ⏱ HUMAN DELAY (Simulate typing)
                const delay = Math.floor(Math.random() * 2500) + 500;
                await new Promise(r => setTimeout(r, delay));

                return reply;
            }
        } catch (e) {
            console.log(`🤖 Model ${model} skipped.`);
        }
    }

    return "My brain is buffering right now. Hit me up in a bit. ✌️"; // Removed Shona fallback
}

// --- 8. MESSAGE HANDLER ---
        const antiSpam = {}; 
        const greetedUsers = new Set(); 
        let lastResetDay = new Date().getDate();

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            const m = messages[0];
            if (!m.message || m.key.fromMe) return;

            const from = m.key.remoteJid;
            const isGroup = from.endsWith('@g.us');
            const sender = m.key.participant || m.key.remoteJid;
            
            // ✨ IDENTITY RECOGNITION
            const masterOwner = '263777426534'; 
            const deployerOwner = process.env.OWNER_NUMBER || ''; 
            const extraIds = process.env.OWNER_IDS ? process.env.OWNER_IDS.split(',') : [];

            const ownerIds = [
                masterOwner,
                deployerOwner,
                ...extraIds,
                '275428249981131',
                '209994490314975',
                '89881082597571'
            ];

            const isOwner = ownerIds.filter(id => id !== '').some(id => sender.startsWith(id));
            const userAdmin = isGroup ? await isAdmin(sock, from, sender) : false;

            // 👑 REACTIONS
            if (isOwner) await sock.sendMessage(from, { react: { text: "👑", key: m.key } });
            else if (userAdmin) await sock.sendMessage(from, { react: { text: "🛡️", key: m.key } });

            // --- 🛡️ ANTI-SPAM LOGIC ---
            const now = Date.now();
            if (!antiSpam[sender]) antiSpam[sender] = { count: 0, lastTime: now };
            if (now - antiSpam[sender].lastTime > 10000) antiSpam[sender].count = 0;
            
            antiSpam[sender].count++;
            antiSpam[sender].lastTime = now;

            if (antiSpam[sender].count > (spamConfig?.limit || 5) && !isOwner) return;

            const body = m.message.conversation || 
                         m.message.extendedTextMessage?.text || 
                         m.message.imageMessage?.caption || 
                         m.message.videoMessage?.caption ||
                         m.message.listResponseMessage?.singleSelectReply?.selectedRowId ||
                         m.message.buttonsResponseMessage?.selectedButtonId || '';
                         
                                     // --- 🕵️ GHOST IDENTITY & ENGAGEMENT ---
            const userRole = isOwner ? 'owner' : (identities[sender] || 'user');

            // 1. AUTO-LEARNING (Master teaches the bot)
            if (isOwner && m.message.extendedTextMessage?.contextInfo?.participant) {
                const text = body.toLowerCase();
                const target = m.message.extendedTextMessage.contextInfo.participant;
                let detected = null;

                if (text.includes('mhamha') || text.includes('mai')) detected = 'mother';
                if (text.includes('daddy') || text.includes('mudhara')) detected = 'dad';
                if (text.includes('babe') || text.includes('stoko')) detected = 'babe';
                if (text.includes('gents') || text.includes('shazi')) detected = 'friend';

                if (detected) {
                    identities[target] = detected;
                    fs.writeFileSync(identitiesPath, JSON.stringify(identities, null, 2));
                    await sock.sendMessage(from, { react: { text: "🧠", key: m.key } });
                }
            }

            // 2. SMART REPLY (Is someone talking to the bot?)
            const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
            const isBotMentioned = body.toLowerCase().includes('bot') || body.toLowerCase().includes('shaddow.t') || body.toLowerCase().includes('kidjustin');
            const isReplyToBot = m.message.extendedTextMessage?.contextInfo?.participant === botNumber;
            const isPrivate = !isGroup;

            if ((isPrivate || isBotMentioned || isReplyToBot) && body.length > 1 && !body.startsWith(config.prefix)) {
                // End Convo Logic
                if (['bye', 'sharp', 'gn', 'ok', 'later'].some(w => body.toLowerCase().includes(w))) {
                    return await sock.sendMessage(from, { react: { text: "🫡", key: m.key } });
                }

                await sock.sendPresenceUpdate('composing', from);
                const aiResponse = await getGhostAI(body, userRole, sender);
if (!aiResponse) return;
                await sock.sendMessage(from, { text: aiResponse }, { quoted: m });
                return; // Stop here so it doesn't trigger holiday greetings twice
            }


            // --- 🎊 PERMANENT ZIMBABWE HOLIDAY SYSTEM ---
            const today = new Date();
            const d = today.getDate();
            const mMonth = today.getMonth() + 1;

            // Reset memory at midnight
            if (d !== lastResetDay) {
                greetedUsers.clear();
                lastResetDay = d;
            }

            // Trigger ONLY on fixed holidays & once per person
            if (!body.startsWith(config.prefix) && !greetedUsers.has(sender) && !m.key.fromMe) {
                let holiday = "";
                let holidayDesc = "Wishing you a great celebration in Zimbabwe.";

                // 🇿🇼 Fixed Annual Public Holidays
                if (d === 1 && mMonth === 1) holiday = "🎊 *HAPPY NEW YEAR*";
                else if (d === 21 && mMonth === 2) holiday = "🇿🇼 *R.G. MUGABE NATIONAL YOUTH DAY*";
                else if (d === 18 && mMonth === 4) {
                    holiday = "🇿🇼 *HAPPY INDEPENDENCE DAY!*";
                    holidayDesc = "Wishing you a great celebration\nof freedom in Zimbabwe.";
                }
                else if (d === 1 && mMonth === 5) holiday = "👷 *WORKERS' DAY*";
                else if (d === 25 && mMonth === 5) holiday = "🌍 *AFRICA DAY*";
                else if (d === 10 && mMonth === 8) holiday = "🎖️ *HEROES' DAY*";
                else if (d === 11 && mMonth === 8) holiday = "🛡️ *DEFENCE FORCES DAY*";
                else if (d === 22 && mMonth === 12) holiday = "🤝 *NATIONAL UNITY DAY*";
                else if (d === 25 && mMonth === 12) holiday = "🎄 *MERRY CHRISTMAS*";
                else if (d === 26 && mMonth === 12) holiday = "🎁 *BOXING DAY*";

                if (holiday) {
                    greetedUsers.add(sender);
                    const holidayMsg = `
╔═════════════════════════════════════╗
┃
┃ ${holiday}
┃
┃ _${holidayDesc}_
┃
┃ \`\`\`    █████████╗
┃ \`\`\`             ██╔═══╝
┃ \`\`\`             ██║
┃ \`\`\`             ██║     ██╗ 
┃ \`\`\`             ╚═╝     ╚═╝            
┃
┃ > **by t.Durani**
┃ [ **VORTEX TECH** ]
╚═════════════════════════════════════╝`.trim();

                    await sock.sendMessage(from, { text: holidayMsg });
                }
            }

            // --- 😴 AFK SYSTEM ---
            if (afkDB[sender]) {
                const afkEntry = afkDB[sender];
                const elapsed = Math.floor((Date.now() - afkEntry.time) / 60000);
                delete afkDB[sender];
                await sock.sendMessage(from, {
                    text: `👋 Welcome back @${sender.split('@')[0]}! You were AFK for *${elapsed} minute${elapsed !== 1 ? 's' : ''}*.`,
                    mentions: [sender]
                });
            }
            // If someone mentions an AFK user, notify them
            const mentionedJids = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
            for (const mentioned of mentionedJids) {
                if (afkDB[mentioned]) {
                    const { reason, time } = afkDB[mentioned];
                    const elapsed = Math.floor((Date.now() - time) / 60000);
                    await sock.sendMessage(from, {
                        text: `😴 @${mentioned.split('@')[0]} is currently *AFK*\n*Reason:* ${reason}\n*Since:* ${elapsed} minute${elapsed !== 1 ? 's' : ''} ago`,
                        mentions: [mentioned]
                    });
                }
            }

            // --- 📊 POLL VOTING SYSTEM ---
            if (isGroup && pollDB[from] && /^[1-9]$/.test(body.trim())) {
                const poll = pollDB[from];
                const voteIndex = parseInt(body.trim()) - 1;
                if (voteIndex >= 0 && voteIndex < poll.options.length) {
                    if (poll.voters[sender]) {
                        await sock.sendMessage(from, {
                            text: `❌ @${sender.split('@')[0]}, you already voted for *${poll.options[poll.voters[sender]]}*!`,
                            mentions: [sender]
                        });
                    } else {
                        poll.votes[voteIndex] = (poll.votes[voteIndex] || 0) + 1;
                        poll.voters[sender] = voteIndex;
                        await sock.sendMessage(from, {
                            text: `✅ @${sender.split('@')[0]} voted for *${poll.options[voteIndex]}*!`,
                            mentions: [sender]
                        });
                    }
                    return;
                }
            }

            // --- 🛡️ ANTI-LINK PROTECTOR ---
            if (isGroup && secDB.antiLink[from] && !isOwner && !userAdmin) {
                if (body.match(/chat\.whatsapp\.com|https?:\/\//gi)) {
                    const botIsAdmin = await isBotAdmin(sock, from);
                    if (botIsAdmin) {
                        await sock.sendMessage(from, { delete: m.key }).catch(() => {});
                        await sock.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {});
                        await sock.sendMessage(from, { text: `🛡️ *Anti-Link System:* @${sender.split('@')[0]} was removed for posting a link.`, mentions: [sender] });
                    } else {
                        console.log('[AntiLink] Bot is not admin, cannot enforce anti-link.');
                    }
                    return;
                }
            }

            // --- COMMAND HANDLER ---
            if (body.startsWith(config.prefix)) {
                const args = body.slice(config.prefix.length).trim().split(/ +/);
                const commandName = args.shift().toLowerCase();

                if (config.mode === 'self' && !isOwner) return;

                const command = findCommand(commandName);
                if (!command) return;

                // 🚫 Global ban check
                if (secDB.blacklisted.includes(sender) && !isOwner) {
                    return sock.sendMessage(from, { text: '🚫 You are banned from using this bot.' }, { quoted: m });
                }

                if (command.ownerOnly && !isOwner) {
                     return sock.sendMessage(from, { text: '⛔ This command is reserved for the Owner only.' }, { quoted: m });
                }
                
                if (command.adminOnly && !userAdmin && !isOwner) {
                     return sock.sendMessage(from, { text: '👥 This command is for Group Admins only.' }, { quoted: m });
                }

                const ctx = {
                    sock, m, from, sender, body, args, isGroup, isOwner,
                    pushName: m.pushName || sender.split('@')[0],
                    commandStartTime: Date.now(),
                    reply: async (text) => { await sock.sendMessage(from, { text }, { quoted: m }); },
                    react: async (emoji) => { await sock.sendMessage(from, { react: { text: emoji, key: m.key } }); }
                };

                try {
                    // ⌨️ Fake typing / 🎙️ Fake recording indicator before every command
                    const gs = getSettings(from);
                    if (gs.autotyping !== false) {
                        // Commands that produce voice/audio — show recording instead of typing
                        const audioCommands = new Set(['speak', 'tts', 'voice', 'play', 'song', 'audio']);
                        const presenceType = audioCommands.has(commandName) ? 'recording' : 'composing';
                        await sock.sendPresenceUpdate(presenceType, from).catch(() => {});
                        await new Promise(r => setTimeout(r, 600));
                    }
                    await ctx.react('⏳');

                    // 📊 XP tracking
                    const usr = getUser(sender);
                    usr.commands++;
                    usr.xp += XP_PER_CMD;
                    while (usr.xp >= xpForLevel(usr.level)) {
                        usr.xp -= xpForLevel(usr.level);
                        usr.level++;
                        await sock.sendMessage(from, { text: `🎉 *Level Up!* @${sender.split('@')[0]} reached *Level ${usr.level}*! 🏆`, mentions: [sender] }).catch(() => {});
                    }

                    await command.execute(ctx).catch(async (err) => {
                        console.error(`❌ Execution Error in [${commandName}]:`, err);
                        await ctx.react('⚠️');
                        await ctx.reply(`🔄 Internal hiccup in *${commandName}*!`);
                    });
                    if (!['answer', 'menu', 'game'].includes(commandName)) await ctx.react('✅');
                    await sock.sendPresenceUpdate('available', from).catch(() => {});
                } catch (globalCmdError) {
                    console.error("🚨 Fatal Command Handler Error:", globalCmdError);
                    await ctx.react('❌');
                }
            } else {
                // 🤖 AUTO-REPLY CHECK (learnDB overrides defaultReplies)
                const msgKey = body.trim().toLowerCase();
                if (msgKey.length > 0 && msgKey.length <= 120) {
                    const defaultReplies = getDefaultReplies();
                    // Find match: exact first, then check if msg starts with any trigger
                    const matchedKey = learnDB[msgKey] !== undefined ? msgKey
                        : defaultReplies[msgKey] !== undefined ? msgKey
                        : Object.keys(learnDB).find(k => msgKey.startsWith(k + ' ') || msgKey === k)
                        || Object.keys(defaultReplies).find(k => msgKey.startsWith(k + ' ') || msgKey === k);

                    if (matchedKey) {
                        const autoResponse = learnDB[matchedKey] !== undefined
                            ? learnDB[matchedKey]
                            : defaultReplies[matchedKey];
                        if (autoResponse) {
                            await sock.sendMessage(from, { text: autoResponse }, { quoted: m });
                        }
                    }
                }

                // 🎮 GAME LISTENER
                const game = activeGames[from];
                if (game && (Date.now() - (game.lastActivity || 0) > 600000)) { 
                    delete activeGames[from];
                    return;
                }
                const answerMatch = body.toLowerCase().trim().match(/^(a|b|c|d)$/);
                if (game && answerMatch && !game.answeredUsers.has(sender) && game.currentRound > 0) {
                    const ctx = { 
                        sock, m, from, sender, body, args: [answerMatch[0].toUpperCase()],
                        reply: async (text) => { await sock.sendMessage(from, { text }, { quoted: m }); },
                        react: async (emoji) => { await sock.sendMessage(from, { react: { text: emoji, key: m.key } }); }
                    };
                    game.lastActivity = Date.now();
                    await commands.answer.execute(ctx);
                }
            }
        });

        // ────────────── CALL BLOCKING ──────────────
        sock.ev.on('call', async (calls) => {
            for (const call of calls) {
                const s = getSettings(call.from || 'global');
                if (s.callblock && call.status === 'offer') {
                    await sock.rejectCall(call.id, call.from).catch(() => {});
                    await sock.sendMessage(call.from, {
                        text: `📵 *Call Blocked*\n\n_Auto-reject is enabled. Please send a message instead._`
                    }).catch(() => {});
                    console.log(`[CallBlock] Rejected call from ${call.from}`);
                }
            }
        });

        // ────────────── AUTO STATUS VIEW ──────────────
        sock.ev.on('messages.upsert', async ({ messages }) => {
            for (const m of messages) {
                if (m.key.remoteJid !== 'status@broadcast') continue;
                const s = getSettings('global');
                if (!s.autoview) continue;
                await sock.readMessages([m.key]).catch(() => {});
            }
        });

        return sock;

    } catch (error) {
        console.error("❌ STARTUP ERROR:", error.message);
        setTimeout(startBot, 5000);
    }
}

// --- INITIALIZATION ---
async function main() {
    // Load persisted data BEFORE starting the bot
    await loadDatabase();
    // Ensure selfDiagnosis exists in your environment
    if (typeof selfDiagnosis === 'function') await selfDiagnosis();
    console.log('╔══════════════════════════════════════════╗');
    console.log(`║ 🚀 Starting ${config.botName} Bot... ║`);
    console.log('╚══════════════════════════════════════════╝\n');
    await startBot();
}

main();

process.on('SIGINT', () => {
    process.exit(0);
});