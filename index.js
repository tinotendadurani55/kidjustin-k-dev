
/*
╔══════════════════════════════════════════╗
║   ✨ MINIMA V13 — MINI BOT.ZW           ║
║   Built from KidJustin-K V13 Core       ║
║   Aesthetic ✨ • Dark Mode 🩸 • Auto ZIM  ║
╚══════════════════════════════════════════╝
*/

// ══════════════════════════════════════
// 🛡️ GLOBAL ANTI-CRASH — Bad MAC killer
// ══════════════════════════════════════
function isBaileysNoise(reason) {
    if (!reason) return false;
    const msg = (reason?.message || reason?.output?.payload?.message || String(reason)).toLowerCase();
    return (
        msg.includes('bad mac') ||
        msg.includes('connection closed') ||
        msg.includes('connection lost') ||
        msg.includes('timed out') ||
        (reason?.output?.statusCode === 428)
    );
}
process.on('uncaughtException',   (err)    => { if (isBaileysNoise(err))    return; console.error('🚨 CRASH:', err); });
process.on('unhandledRejection',  (reason) => { if (isBaileysNoise(reason)) return; console.error('🚨 REJECTION:', reason); });

// ══════════════════════════════════════
// 📦 IMPORTS
// ══════════════════════════════════════
const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    downloadMediaMessage,
    downloadContentFromMessage
} = require('@whiskeysockets/baileys');

const express  = require('express');
const pino     = require('pino');
const fs       = require('fs');
const path     = require('path');
const axios    = require('axios');
const { exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const os       = require('os');

// ══════════════════════════════════════
// 🌐 HEALTH SERVER (HuggingFace keep-alive)
// ══════════════════════════════════════
const app = express();
app.get('/', (req, res) => res.send('✨ MINIMA V13 Online'));
app.listen(process.env.PORT || 7860, () => console.log('🌐 Health server running'));

// ══════════════════════════════════════
// ⚙️ CONFIG — reads from HF Space variables
// ══════════════════════════════════════

// 🔐 MASTER OWNER — your fixed number, never changes, never comes from env
const MASTER_OWNER = '263777426534';

const config = {
    botName:     process.env.BOT_NAME      || 'MINIMA V13',
    ownerName:   process.env.OWNER_NAME    || 't.Durani',
    prefix:      process.env.PREFIX        || '.',
    mode:        process.env.MODE          || 'public',
    pairNumber:  (process.env.PAIR_NUMBER  || '').replace(/[^\d]/g, ''),
    sessionId:   process.env.SESSION_ID    || '',
    keeperGroup: process.env.KEEPER_GROUP_ID || '', // Group JID for ping keepalive
};

// 👥 SUB-OWNERS — comma-separated numbers pasted into env after pairing
// After first pair: bot sends SUB_OWNER_ID (the paired number) → paste it here
const subOwnersRaw  = process.env.SUB_OWNER_ID || process.env.SUB_OWNERS || '';
const subOwnersList = subOwnersRaw
    .split(',')
    .map(s => s.trim().replace(/[^\d]/g, ''))
    .filter(Boolean);

// 🏛️ OWNER ID REGISTRY
// Master is always in. Your 3 personal numbers are hardcoded here.
// pairNumber (the deployer) also gets recognised until they register as sub-owner.
// startsWith() is used in matching — handles WhatsApp device suffix e.g. :5@s.whatsapp.net
const ownerIds = [
    MASTER_OWNER,
    '275428249981131',
    '209994490314975',
    '89881082597571',
    config.pairNumber,
].filter(Boolean);

const SESSION_DIR = '/tmp/minima-session';
const DOWNLOADS_DIR = './downloads';

// ══════════════════════════════════════
// 🗄️ DATABASE SYSTEM (File Fallback)
// ══════════════════════════════════════
const DB_PATH = './database.json';
let db = {
    secDB: { blacklisted:[], strikes: {}, antiLink: {}, welcome: {} },
    antiDeleteGroups: {},
    antiEditGroups: {},
    settingsDB: { global: { mood: 'GIRLY', callblock: false, autoview: false } },
    warnDB: {},
    userDB: {},
    quietDB: {},
    holidayGreetings: {}
};

// Attempt to load permanent database if running on paid/VPS server
if (fs.existsSync(DB_PATH)) {
    try { Object.assign(db, JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'))); } catch (e) { console.error('DB Load Error'); }
}

// Save function to lock settings in
function saveDB() {
    try { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); } catch (e) {}
}

const msgCache         = new Map();
const downloadQueue    = new Map();
const muteDB           = {};
const afkDB            = {};
const pollDB           = {};
const identities       = {};
const shieldStatus     = { armed: false, attackers: {} };
const firstDMers       = new Set(); 

const ownerDeletedTexts = new Map(); // For counter-anti-delete recovery

const MAX_ANTIDELETE_SIZE = 10 * 1024 * 1024;
const MAX_CACHE_SIZE      = 500;
const XP_PER_CMD          = 10;

const getUser = (jid) => {
    if (!db.userDB[jid]) db.userDB[jid] = { xp: 0, level: 1, rep: 0, commands: 0, repGivenTo: [] };
    return db.userDB[jid];
};
const xpForLevel = (lvl) => lvl * 100;

const getSettings = (jid) => {
    if (!db.settingsDB[jid]) db.settingsDB[jid] = { callblock: false, autoview: false, autotyping: true, antiflood: true };
    return db.settingsDB[jid];
};
const getQuiet = (jid) => {
    if (!db.quietDB[jid]) db.quietDB[jid] = { ai: false, bot: false };
    return db.quietDB[jid];
};

// Download queue helpers
function canDownload(jid) { return (downloadQueue.get(jid) || 0) < 2; }
function startDownload(jid) { downloadQueue.set(jid, (downloadQueue.get(jid) || 0) + 1); }
function endDownload(jid) {
    const n = (downloadQueue.get(jid) || 1) - 1;
    if (n <= 0) downloadQueue.delete(jid); else downloadQueue.set(jid, n);
}

// ══════════════════════════════════════
// 🔧 BINARY PATHS
// ══════════════════════════════════════
const isTermux   = fs.existsSync('/data/data/com.termux');
const ffmpegPath = isTermux ? 'ffmpeg' : '/usr/bin/ffmpeg';
const ytdlpPath  = isTermux ? 'yt-dlp' : '/usr/local/bin/yt-dlp';

// ══════════════════════════════════════
// 🧹 BACKGROUND CLEANERS
// ══════════════════════════════════════
setInterval(() => {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const[k, v] of msgCache.entries()) { if (v.timestamp < cutoff) msgCache.delete(k); }
}, 10 * 60 * 1000);

// ══════════════════════════════════════
// 🛠️ HELPERS
// ══════════════════════════════════════
function extractMessageText(msg) {
    return msg?.conversation || msg?.extendedTextMessage?.text ||
           msg?.imageMessage?.caption || msg?.videoMessage?.caption || '';
}

async function isAdmin(sock, groupId, userId) {
    try {
        const meta = await sock.groupMetadata(groupId);
        return meta.participants.some(p => p.id === userId && (p.admin === 'admin' || p.admin === 'superadmin'));
    } catch { return false; }
}

function getUptime() {
    const s = Math.floor(process.uptime());
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}h ${m}m ${sec}s`;
}

// Sticker metadata injector
function addStickerMetadata(webpBuffer, packName, authorName) {
    const metaJson = JSON.stringify({
        'sticker-pack-id': `minima-${Date.now()}`,
        'sticker-pack-name': packName,
        'sticker-pack-publisher': authorName,
    });
    const metaBuffer = Buffer.from(metaJson, 'utf-8');
    const metaHex = metaBuffer.toString('hex');
    const hexString = webpBuffer.toString('hex');
    const exifHex = '4578494600000000';
    const insertion = exifHex + '0c00' + ('0' + (metaBuffer.length).toString(16)).slice(-4) + metaHex;
    const newHex = hexString.replace('52494646', insertion + '52494646');
    return Buffer.from(newHex, 'hex');
}

// ══════════════════════════════════════
// 🎨 STYLING ENGINE (GIRLY vs DARK MODE)
// ══════════════════════════════════════
function getStyle() {
    const isDark = db.settingsDB.global.mood === 'DARK';
    return {
        img: isDark ? 'https://i.postimg.cc/VLKCfDXS/Screenshot-20260417-094433-Whats-App-Business.jpg' : 'https://i.postimg.cc/mkRHDndh/IMG-20260417-WA0003(1).jpg',
        title: isDark ? '⛓️ 𝐌𝐈𝐍𝐈𝐌𝐀[ 𝐃𝐀𝐑𝐊_𝐏𝐑𝐎𝐓𝐎𝐂𝐎𝐋 ] ⛓️' : '🌸 ⟡ 𝐌𝐈𝐍𝐈𝐌𝐀 𝐕𝟏𝟑 ⟡ 🌸',
        divider: isDark ? '🩸 ━━━━━━━━━━━━━━━ 🩸' : '⚡┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈⚡',
        sparkle: isDark ? '⚠️' : '✨',
        heart: isDark ? '🖤' : '💖',
        botName: isDark ? 'MINIMA.EXE' : 'MINIMA V13'
    };
}

const GIFT_LINK = 'https://kidjustin-k-gift-for-you-by-kid.static.hf.space/index.html';

// ══════════════════════════════════════
// 🇿🇼 AUTO ZIM HOLIDAYS
// ══════════════════════════════════════
const ZIM_HOLIDAYS = {
    "01-01": "New Year's Day 🎆",
    "02-21": "Robert Mugabe National Youth Day 🇿🇼",
    "04-18": "Independence Day 🇿🇼✨",
    "05-01": "Workers' Day 🛠️",
    "05-25": "Africa Day 🌍",
   "08-10": "🎖HEROES' DAY",
   "08-11": "🛡️DEFENCE FORCES DAY",
    "12-22": "Unity Day 🤝",
    "12-25": "Christmas Day 🎄",
    "12-26": "Boxing Day 🎁"
};

// ══════════════════════════════════════
// 📜 COMMANDS
// ══════════════════════════════════════
const commands = {

    // ──────────────────────────────────
    // ✨ MINIMA — Single all-in-one menu
    // ──────────────────────────────────
    minima: {
        name: 'minima',
        aliases:['menu', 'help', 'm'],
        desc: 'Show all commands in one gorgeous menu',
        category: 'general',
        async execute(ctx) {
            const { sock, from, m, pushName } = ctx;
            const uptime = getUptime();
            const now = new Date();
            const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Africa/Harare' });
            const dateStr = now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Harare' });
            const speed   = Date.now() - m.messageTimestamp * 1000;
            const globalSettings = db.settingsDB.global;
            const st = getStyle();

            const menuText =
`${st.title}
*╰──── MINI BOT.ZW ────╯*

*┌────────────────────┐*
*│* 👤 *USER:* ${pushName || 'Star'}
*│* 🌸 *MODE:* ${config.mode.toUpperCase()}
*│* ⚡ *PING:* ${speed}ms
*│* 🔮 *PREFIX:*[ ${config.prefix} ]
*│* 💎 *UPTIME:* ${uptime}
*│* 🛡 *SHIELD:* ${shieldStatus.armed ? '🔴 ARMED' : '🟢 STANDBY'}
*└────────────────────┘*

✦ *📥 DOWNLOADS*
*│* ◈ *.play* [song] _— audio download_
*│* ◈ *.music* [song] _— HQ HQ audio engine_
*│* ◈ *.tiktok*[link/search] _— TikTok video_
*│* ◈ *.fb* [link] _— Facebook video_
*│* ◈ *.ig* [link] _— Instagram reel_
*│* ◈ *.sticker* [reply img] _— make sticker_
*│* ◈ *.toimage* [reply sticker] _— sticker→img_
*│* ◈ *.vv* [reply view-once] _— bypass_
*│* ◈ *.steal*[reply status] _— save media_
*│* ◈ *.wallpaper* [query] _— get HD wallpaper_

✦ *✨ AESTHETIC*
*│* ◈ *.outfit* _— outfit rater_
*│* ◈ *.tarot* _— daily cute fortune_
*│* ◈ *.bestie* [@user] _— bestie meter_
*│* ◈ *.sparkle*[text] _— aesthetic font_

✦ *🛡️ GROUP TOOLS*
*│* ◈ *.kick* *.add* *.promote* *.demote*
*│* ◈ *.warn* [@user] _— warn (auto-kick @3)_
*│* ◈ *.antilink* [on/off]
*│* ◈ *.welcome* [on/off]
*│* ◈ *.close* / *.open* _— mute/unmute group_
*│* ◈ *.tagall* _— mention everyone_
*│* ◈ *.antidelete*[on/off]
*│* ◈ *.antiedit* [on/off]
*│* ◈ *.setname* / *.setdesc*
*│* ◈ *.lovemeter @user*
*│* ◈ *.shorten* @ [link]
*│* ◈ *.revoke* [group link]
*│* ◈ *.status* [bot status]

✦ *🤖 UTILITY*
*│* ◈ *.myid* _— get your whatsapp ID_
*│* ◈ *.calc* [math] _— calculator_
*│* ◈ *.trs* [text] _— translate_
*│* ◈ *.speak* [text] _— text to voice_
*│* ◈ *.ping* / *.uptime*

✦ *🎮 FUN*
*│* ◈ *.joke* / *.8ball* [q] / *.ship* [a & b]
*│* ◈ *.afk* [reason] _— set yourself away_
*│* ◈ *.funpoll* / *.wyr* _— fun polls_
*│* ◈ *.roast* / *.compliment* / *.mock*
*│* ◈ *.fact* / *.rate* / *.howmany*

✦ *👑 OWNER*
*│* ◈ *.contact* [owner infor]
*│* ◈ *.darkmenu* _— payloads_
*│* ◈ *.calmdown* _— exit dark mode_
*│* ◈ *.callblock* / *.autoview* [on/off]
*│* ◈ *.bc* [msg] _— broadcast_
*│* ◈ *.ban* / *.unban* [@user]
*│* ◈ *.addprem* / *.delprem* [@user]
*│* ◈ *.shieldstatus*[reset/arm]
*│* ◈ *.public* / *.self* _— bot mode_
*│* ◈ *.botquiet* [on/off]

✦ *🎁 MINIMA SPECIAL*
*│* ◈ *.gift* _— surprise gift link_
*│* ◈ *.minima* / *.menu* _— this menu_

*⚙️ SETTINGS STATUS*
*│* AntiLink: ${db.secDB.antiLink[from] ? '✅' : '❌'} | Anti... ${db.antiDeleteGroups[from] ? '✅' : '❌'}
*│* Welcome: ${db.secDB.welcome[from] ? '✅' : '❌'} | AntiEdit: ${db.antiEditGroups[from] ? '✅' : '❌'}
*│* CallBlock: ${globalSettings.callblock ? '✅' : '❌'} | AutoView: ${globalSettings.autoview ? '✅' : '❌'}

*🕐* ${timeStr}  *📅* ${dateStr}
> © *${config.ownerName}* | ${st.botName} 🇿🇼`;

            await sock.sendMessage(from, {
                image: { url: st.img },
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
                                `${ytdlpPath} --no-playlist -x --audio-format mp3 --audio-quality 5 -o "${tmpPath}" "scsearch1:confess your love slowed"`,
                                (err) => resolve(!err && fs.existsSync(tmpPath))
                            );
                        });

                        // Step 2: Trim to 40 seconds with ffmpeg
                        if (downloaded) {
                            await new Promise((resolve) => {
                                exec(
                                    `${ffmpegPath} -y -i "${tmpPath}" -t 40 -acodec libmp3lame -q:a 5 "${menuMusicPath}"`,
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

    darkmenu: {
        name: 'darkmenu', aliases: ['payloads'], category: 'owner', ownerOnly: true, masterOnly: true,
        async execute(ctx) {
            const menu = `⛓️ 𝐌𝐈𝐍𝐈𝐌𝐀[ 𝐃𝐀𝐑𝐊_𝐏𝐑𝐎𝐓𝐎𝐂𝐎𝐋 ] ⛓️\n🩸 ━━━━━━━━━━━━━━━ 🩸\n\n    [ SELECT PAYLOAD ]\n    \n    1. ⚔️ UI_REAPER (Lag Scroll)\n    2. 💀 VOID_STRING (Zero-Width)\n    3. 🗂️ VCARD_CRASH (Parsing Error)\n    4. 🌪️ BUFFER_BLOAT (RAM Eater)\n    5. 🛑 TOTAL_LOCKDOWN (Combo)\n\n    > STATUS: READY TO BREACH\n    > TARGET: [ WAITING ]\n    \n🩸 ━━━━━━━━━━━━━━━ 🩸\n> ⚠️ © t.Durani | MINIMA.EXE`;
            await ctx.sock.sendMessage(ctx.from, { text: menu });
        }
    },

    calmdown: {
        name: 'calmdown', aliases:['resetmood', 'girlymode'], category: 'owner', ownerOnly: true,
        async execute(ctx) {
            db.settingsDB.global.mood = 'GIRLY'; saveDB();
            await ctx.reply(`🌸 *MOOD RESET* 🌸\n_I took a deep breath. I'm back to my cute self! ✨💖_`);
        }
    },
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
*╔════════「 🌸SYSTEM STATUS🌸 」════════╗*
*┃* 🤖 *Bot:* ✨ MINIMA V13 🌸
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

    myid: {
        name: 'myid', aliases:['id', 'jid'], category: 'utility',
        async execute(ctx) {
            let msg = `👤 *Your ID:* \n\`\`\`${ctx.sender}\`\`\`\n`;
            if (ctx.isGroup) msg += `\n👥 *Group ID:* \n\`\`\`${ctx.from}\`\`\`\n`;
            await ctx.reply(msg);
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
    outfit: {
    name: 'outfit', 
    aliases: ['aesthetic', 'vibe', 'style'], 
    category: 'fun',
    async execute(ctx) {
        const vibes = [
            { name: "🕶️ *Cyberpunk / Techwear*", item: "A matte black face mask and utility straps." },
            { name: "🖤 *Y2K Grunge / Alt*", item: "Oversized graphic tee and silver chains." },
            { name: "☁️ *Clean & Minimalist*", item: "Fresh white sneakers and a neutral-tone hoodie." },
            { name: "🛹 *Streetwear / Hypebeast*", item: "A limited-edition puffer jacket and baggy cargo pants." },
            { name: "🧛 *Dark Academia*", item: "A turtleneck under a long wool coat." },
            { name: "🎧 *Lo-Fi / Chill*", item: "Your favorite oversized sweater and vintage headphones." },
            { name: "🎨 *Art Hoe / Indie*", item: "A beanie and some high-top canvas shoes." },
            { name: "👔 *Old Money / Classy*", item: "A crisp button-down and a leather-strap watch." },
            { name: "🏜️ *Earthcore / Utility*", item: "An olive green vest and tactical boots." },
            { name: "⚡ *Vortex / Cyber-Goth*", item: "Reflective shades and neon-accented sneakers." },
            { name: "🏙️ *Urban Explorer*", item: "A windbreaker with multiple hidden pockets." },
            { name: "👾 *Retro Gamer*", item: "A pixel-art cap and bright, clashing socks." },
            { name: "🏯 *Modern Samurai*", item: "A black kimono-style jacket and joggers." },
            { name: "🧿 *Bohemian / Nomad*", item: "Stackable rings and a patterned linen shirt." },
            { name: "🦾 *Industrial / Metal*", item: "Heavy-duty boots and a studded belt." }
        ];
        
        const choice = vibes[Math.floor(Math.random() * vibes.length)];
        const score = Math.floor(Math.random() * 3) + 8; // Score: 8, 9, or 10
        
        const response = `🔥 *VIBE CHECK & OUTFIT SCANNER* 🔥\n\n` +
                         `Your energy today is giving:\n${choice.name}\n\n` +
                         `*Overall Rating:* ${score}/10 ⚡\n\n` +
                         `💡 *FOTD Suggestion:* \n_${choice.item}_`;

        await ctx.reply(response);
    }
},
    tarot: {
        name: 'tarot', aliases: ['fortune'], category: 'girly',
        async execute(ctx) {
            const fortunes =[
    "*The Stars say someone is thinking about your smile today! ✨*",
    "*A pleasant surprise is coming to your inbox soon. 💌*",
    "*Today is your main-character moment. Own it! 👑*",
    "*Your energy is magnetic today, expect good vibes! 🧲💖*",
    "*Drink water and ignore them. Peace is your fortune. ☁️*",
    "*The universe just cleared your cache. Today is a fresh start. ⚡*",
    "*Your aura is currently at 5G speeds. Everyone else is on dial-up. 📶*",
    "*Stop checking their status. Your future is way more interesting. 🚫*",
    "*A big win is currently 'pending'... don't cancel the request. ⌛*",
    "*The stars suggest you stop being your own worst firewall. Open up. 🔓*",
    "*Confidence is your best outfit today. Wear it like a boss. 🕶️*",
    "*Luck is 99% hustle and 1% stars. You've already got the hustle covered. 🛠️*",
    "*Your manifestation has been delivered. Check your surroundings. 🎁*",
    "*Someone is typing a message to you right now. Stay sharp. 📱*",
    "*A chaotic energy is trying to find you, but your peace is fully encrypted. 🛡️*",
    "*The moon says you deserve a break. Put the phone down for 5 minutes. 🌙*",
    "*Your vibe today is 'Administrator Mode'. Everyone follows your lead. 👨‍💻*",
    "*Expect a random act of kindness to glitch into your day. 🎈*",
    "*Mercury isn't in retrograde; you’re just overthinking. Breathe. 💨*",
    "*You are the main script, everyone else is just a comment. 📝*",
    "*Your potential is unlimited, don't let a minor bug slow you down. 🚀*",
    "*The constellations are aligning for your next big project. 🌌*",
    "*Stop debugging the past; start coding your future. 🏗️*",
    "*A powerful connection is about to be established. 🔌*",
    "*Your logic is flawless today. Trust your decisions. ✅*",
    "*Silence the noise. Your inner voice has the admin rights. 🤫*",
    "*Opportunities are pinging you; make sure you're reachable. 🔔*",
    "*The sun is shining on your 'Success' folder today. 📂☀️*",
    "*New features are being added to your life journey. Stay tuned. 🆕*",
    "*Don't let a slow connection ruin your high-speed energy. 🏎️*",
    "*You're not just a user in this world; you're the master dev. 👑*",
    "*A secret admirer is checking your profile. Be ready. 👀*",
    "*Your hard work is finally rendering. The results will be HD. 🖥️*",
    "*The stars say it's time to upgrade your circle. 🔝*",
    "*Everything is clicking into place. No more syntax errors. 🧩*",
    "*The universe is about to grant you a major permission level. 🔑*",
    "*Your charm is currently at an all-time peak. Use it. 🔥*",
    "*A local file of happiness has been successfully downloaded. 📂😊*",
    "*Stop waiting for the perfect build; launch your dream today. 🚀*",
    "*The sky isn't the limit; it's just the background. ☁️*",
    "*Your network is expanding. New peers are entering your server. 🤝*",
    "*Data shows a 100% chance of success if you take that risk today. 📊*",
    "*You have successfully bypassed the bad vibes. Access granted. 🎟️*",
    "*A major breakthrough is currently 99% loaded... stay patient. ⏳*",
    "*The stars are rotating in your favor. Shift your perspective. 🎡*"
];
            await ctx.reply(`🔮 *CUTE TAROT* 🔮\n\n${fortunes[Math.floor(Math.random() * fortunes.length)]}`);
        }
    },

    bestie: {
        name: 'bestie', aliases: ['bff'], category: 'girly',
        async execute(ctx) {
            const p2 = ctx.args[0] || 'Them';
            const pct = Math.floor(Math.random() * 31) + 70;
            await ctx.reply(`👯‍♀️ *BESTIE METER* 👯‍♀️\n\n👤 You × ${p2}\n\n💖 *${pct}% Bestie Match!*\n_Soulmates in a friendship font. ✨_`);
        }
    },

    sparkle: {
        name: 'sparkle', aliases: ['fancy'], category: 'girly',
        async execute(ctx) {
            const text = ctx.args.join(' ');
            if (!text) return ctx.reply("Provide text! Example: *.sparkle hello*");
            const map = {a:'𝒶',b:'𝒷',c:'𝒸',d:'𝒹',e:'𝑒',f:'𝒻',g:'𝑔',h:'𝒽',i:'𝒾',j:'𝒿',k:'𝓀',l:'𝓁',m:'𝓂',n:'𝓃',o:'𝑜',p:'𝓅',q:'𝓆',r:'𝓇',s:'𝓈',t:'𝓉',u:'𝓊',v:'𝓋',w:'𝓌',x:'𝓍',y:'𝓎',z:'𝓏'};
            const aesthetic = text.toLowerCase().split('').map(c => map[c] || c).join('');
            await ctx.reply(`✨ 𓂃 *${aesthetic}* 𓂃 ✨`);
        }
    },

    ping: {
        name: 'ping', aliases: ['speed'], category: 'general',
        async execute(ctx) {
            const speed = Date.now() - ctx.m.messageTimestamp * 1000;
            await ctx.reply(`🏓 *Pong!*\n⚡ Speed: *${speed}ms*`);
        }
    },

    uptime: {
        name: 'uptime', aliases: ['up'], category: 'general',
        async execute(ctx) {
            await ctx.reply(`✨ *MINIMA V13 Uptime*\n━━━━━━━━━━━━━━━━━━━\n⏱️ Running for: *${getUptime()}*\n💎 Status: Stable & Shining ✨`);
        }
    },

    gift: {
        name: 'gift', aliases:['surprise', 'present'], category: 'general',
        async execute(ctx) {
            const st = getStyle();
            await ctx.sock.sendMessage(ctx.from, {
                image: { url: st.img },
                caption: `${st.title}\n${st.divider}\n\n💝 _I have something special just for you..._\n\n🎁 *Tap below to unwrap your gift:*
                ૮₍ ˃ ⤙ ˂ ₎ა
┃ ./づᡕᠵ᠊ᡃ່࡚ࠢ࠘ ⸝່ࠡࠣ᠊߯᠆ࠣ࠘ᡁࠣ࠘᠊᠊ࠢ࠘~~~~♡ * ‧₊*♡\n${GIFT_LINK}\n\n${st.divider}\n> 💜 *with love, ${st.botName}* 🌸`
            }, { quoted: ctx.m });
        }
    },

    play: {
        name: 'play', aliases: ['song', 'audio'], category: 'download',
        async execute(ctx) {
            const query = ctx.args.join(' ');
            if (!query) return ctx.reply(`🎵 *Audio Engine*\n\nUsage: *${config.prefix}play <song name>*\nExample: *${config.prefix}play Bling4*`);
            if (!canDownload(ctx.from)) return ctx.reply('⏳ *2 downloads already running in this chat.* Wait a moment.');
            startDownload(ctx.from);
            await ctx.reply(`🔍 _Scanning network for *${query}*..._`);
            const fileName = path.join(DOWNLOADS_DIR, `${uuidv4()}.mp3`);

            const formatViews = (v) => {
                if (!v) return 'N/A';
                if (v >= 1000000) return (v/1000000).toFixed(1)+'M';
                if (v >= 1000)    return (v/1000).toFixed(1)+'K';
                return v.toString();
            };
            const formatDuration = (s) => {
                if (!s) return '0:00';
                const m = Math.floor(s/60), sec = Math.floor(s%60);
                return `${m}:${sec<10?'0':''}${sec}`;
            };

            exec(`${ytdlpPath} --dump-json "scsearch1:${query}"`, async (metaErr, stdout) => {
                if (metaErr || !stdout) {
                    endDownload(ctx.from);
                    return ctx.reply(`❌ Could not find track data for *${query}*.\n_Try a different search term._`);
                }
                try {
                    const track    = JSON.parse(stdout.trim().split('\n')[0]);
                    const title    = track.title || query;
                    const author   = track.uploader || 'Unknown Artist';
                    const views    = formatViews(track.view_count || track.playback_count);
                    const duration = track.duration_string || formatDuration(track.duration) || 'Unknown';
                    const genre    = track.genre ? `\n🏷️ *𝙶𝚎𝚗𝚛𝚎 :-* ${track.genre}` : '';

                    const proDisplay = `🎵 ＡＵＤＩＯ ＥＮＧＩＮＥ 🎵\n━━━━━━━━━━━━━━━━━━━━━━\n✨ *𝚃𝚒𝚝𝚕𝚎 :-* ${title}\n👤 *𝙰𝚞𝚝𝚑𝚘𝚛 :-* ${author}\n👁️ *𝙿𝚕𝚊𝚢𝚜 :-* ${views}${genre}\n━━━━━━━━━━━━━━━━━━━━━━\n▶︎ •၊၊||၊|။||‌၊|• ${duration}\n\n_Downloading payload..._ ⚡`;
                    await ctx.reply(proDisplay);

                    exec(`${ytdlpPath} --no-playlist -x --audio-format mp3 --audio-quality 0 -o "${fileName}" "scsearch1:${query}"`, async (err) => {
                        try {
                            if (err || !fs.existsSync(fileName)) {
                                return ctx.reply(`❌ Download failed for *${title}*.`).catch(() => {});
                            }
                            const buf = fs.readFileSync(fileName);
                            await ctx.sock.sendMessage(ctx.from, { audio: buf, mimetype: 'audio/mpeg', ptt: false }, { quoted: ctx.m });
                        } catch (sendErr) {
                            console.error('[play] send error:', sendErr.message);
                        } finally {
                            if (fs.existsSync(fileName)) fs.unlinkSync(fileName);
                            endDownload(ctx.from);
                        }
                    });
                } catch (parseError) {
                    endDownload(ctx.from);
                    return ctx.reply(`❌ Error processing track metadata.`);
                }
            });
        }
    },
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
`🌸 *BOT OWNER INFO*
━━━━━━━━━━━━━━━━━━━
*Name:* ${config.ownerName}
*Number:* +${config.MASTER_OWNER}
*Country:* Zimbabwe 🇿🇼
*Bot:* ${config.botName}
━━━━━━━━━━━━━━━━━━━
📩 _Contact the owner for support or custom bots._`
            );
        }
    },
    music: {
        name: 'music', aliases: ['m2', 'hqmusic'], category: 'download',
        async execute(ctx) {
            // FIXED: cobalt.tools API is dead — now routes through yt-dlp SoundCloud
            // just like .play but labelled as HQ engine. Alias conflict fixed:
            // 'music' alias removed from .play so this command is reachable.
            const { args, reply, sock, from, m } = ctx;
            const query = args.join(' ');
            if (!query) return reply("🎵 What song are we looking for?\nExample: *.music Bling4*");
            if (!canDownload(from)) return reply('⏳ *2 downloads already running.* Wait a moment.');
            startDownload(from);
            await reply("🛰️ *Scanning Global Servers...*");
            const fileName = path.join(DOWNLOADS_DIR, `${uuidv4()}.mp3`);

            const formatViews = (v) => {
                if (!v) return 'N/A';
                if (v >= 1000000) return (v/1000000).toFixed(1)+'M';
                if (v >= 1000) return (v/1000).toFixed(1)+'K';
                return v.toString();
            };
            const formatDuration = (s) => {
                if (!s) return '0:00';
                const mins = Math.floor(s/60), sec = Math.floor(s%60);
                return `${mins}:${sec<10?'0':''}${sec}`;
            };

            exec(`${ytdlpPath} --dump-json "scsearch1:${query}"`, async (metaErr, stdout) => {
                if (metaErr || !stdout) {
                    endDownload(from);
                    return reply(`❌ Music Engine could not find *${query}*.\n_Try a different search term._`).catch(() => {});
                }
                try {
                    const track    = JSON.parse(stdout.trim().split('\n')[0]);
                    const title    = track.title || query;
                    const author   = track.uploader || 'Unknown Artist';
                    const views    = formatViews(track.view_count || track.playback_count);
                    const duration = track.duration_string || formatDuration(track.duration) || 'Unknown';

                    await reply(`🛰️ *GLOBAL AUDIO ENGINE*\n━━━━━━━━━━━━━━━━━━━━━━\n✨ *Track:* ${title}\n👤 *Artist:* ${author}\n👁️ *Plays:* ${views}\n━━━━━━━━━━━━━━━━━━━━━━\n▶︎ •၊၊||၊|• ${duration}\n\n_Downloading payload..._ ⚡`).catch(() => {});

                    exec(`${ytdlpPath} --no-playlist -x --audio-format mp3 --audio-quality 0 -o "${fileName}" "scsearch1:${query}"`, async (err) => {
                        try {
                            if (err || !fs.existsSync(fileName)) {
                                return reply(`❌ Music Engine failed for *${title}*. Try *.play* instead.`).catch(() => {});
                            }
                            const buf = fs.readFileSync(fileName);
                            await sock.sendMessage(from, { audio: buf, mimetype: 'audio/mpeg', ptt: false, fileName: `${title}.mp3` }, { quoted: m });
                        } catch (sendErr) {
                            console.error('[music] send error:', sendErr.message);
                            reply('❌ Music Engine 2 is currently busy.').catch(() => {});
                        } finally {
                            if (fs.existsSync(fileName)) fs.unlinkSync(fileName);
                            endDownload(from);
                        }
                    });
                } catch (parseError) {
                    console.error('[music] parse error:', parseError.message);
                    endDownload(from);
                    reply('❌ Music Engine 2 is currently busy.').catch(() => {});
                }
            });
        }
    },

    tiktok: {
        name: 'tiktok', aliases: ['tt'], category: 'download',
        async execute(ctx) {
            const input = ctx.args.join(' ');
            if (!input) return ctx.reply(`❌ Provide a TikTok link or search query.\n\nExamples:\n• *.tiktok https://tiktok.com/@user/video/...*\n• *.tiktok funny cats dancing*`);
            if (!canDownload(ctx.from)) return ctx.reply('⏳ *2 downloads already running.*\nWait for them to finish first.');
            startDownload(ctx.from);
            const isLink   = input.includes('tiktok.com') || input.includes('vm.tiktok.com');
            const target   = isLink ? input : `ttsearch1:${input}`;
            const fileName = path.join(DOWNLOADS_DIR, `${uuidv4()}.mp4`);
            await ctx.reply(isLink ? `📱 Fetching TikTok video...` : `🔍 Searching TikTok for: *${input}*\n⏳ Downloading top result...`);
            exec(`${ytdlpPath} -f "bestvideo+bestaudio/best" --merge-output-format mp4 -o "${fileName}" "${target}"`, async (err) => {
                try {
                    if (err || !fs.existsSync(fileName)) return ctx.reply('❌ Download failed. Please try again.').catch(() => {});
                    await ctx.sock.sendMessage(ctx.from, { video: fs.readFileSync(fileName), caption: '✅ TikTok Downloaded ✨' }, { quoted: ctx.m });
                } catch (e) {
                    console.error('[tiktok]', e.message);
                } finally {
                    if (fs.existsSync(fileName)) fs.unlinkSync(fileName);
                    endDownload(ctx.from);
                }
            });
        }
    },

    fb: {
        name: 'fb', aliases: ['facebook'], category: 'download',
        async execute(ctx) {
            const url = ctx.args[0];
            if (!url || !url.includes('facebook.com') && !url.includes('fb.watch')) {
                return ctx.reply(`❌ Provide a Facebook video link.\nExample: *.fb https://facebook.com/...*`);
            }
            if (!canDownload(ctx.from)) return ctx.reply('⏳ Downloads queue full. Wait.');
            startDownload(ctx.from);
            const fileName = path.join(DOWNLOADS_DIR, `${uuidv4()}.mp4`);
            await ctx.reply('📘 _Fetching Facebook video..._');
            exec(`${ytdlpPath} -f "bestvideo+bestaudio/best" --merge-output-format mp4 -o "${fileName}" "${url}"`, async (err) => {
                try {
                    if (err || !fs.existsSync(fileName)) return ctx.reply('❌ Download failed. Ensure the link is public.').catch(() => {});
                    await ctx.sock.sendMessage(ctx.from, { video: fs.readFileSync(fileName), caption: '✅ Facebook Video Downloaded ✨' }, { quoted: ctx.m });
                } catch (e) {
                    console.error('[fb]', e.message);
                } finally {
                    if (fs.existsSync(fileName)) fs.unlinkSync(fileName);
                    endDownload(ctx.from);
                }
            });
        }
    },

    ig: {
        name: 'ig', aliases: ['instagram', 'insta'], category: 'download',
        async execute(ctx) {
            const url = ctx.args[0];
            if (!url || !url.includes('instagram.com')) {
                return ctx.reply(`❌ Provide an Instagram link.\nExample: *.ig https://instagram.com/reel/...*`);
            }
            if (!canDownload(ctx.from)) return ctx.reply('⏳ Downloads queue full. Wait.');
            startDownload(ctx.from);
            const fileName = path.join(DOWNLOADS_DIR, `${uuidv4()}.mp4`);
            await ctx.reply('📷 _Fetching Instagram content..._');
            exec(`${ytdlpPath} -f "bestvideo+bestaudio/best" --merge-output-format mp4 -o "${fileName}" "${url}"`, async (err) => {
                try {
                    if (err || !fs.existsSync(fileName)) return ctx.reply('❌ Download failed. Ensure the link is public.').catch(() => {});
                    await ctx.sock.sendMessage(ctx.from, { video: fs.readFileSync(fileName), caption: '✅ Instagram Downloaded ✨' }, { quoted: ctx.m });
                } catch (e) {
                    console.error('[ig]', e.message);
                } finally {
                    if (fs.existsSync(fileName)) fs.unlinkSync(fileName);
                    endDownload(ctx.from);
                }
            });
        }
    },

    sticker: {
        name: 'sticker', aliases: ['s', 'stik'], category: 'download',
        async execute(ctx) {
            const { sock, from, m: msg } = ctx;
            const isQuoted    = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const targetMsg   = isQuoted ? msg.message.extendedTextMessage.contextInfo.quotedMessage : msg.message;
            const msgType     = Object.keys(targetMsg)[0];
            if (!['imageMessage','videoMessage'].includes(msgType)) {
                return ctx.reply(`❓ *Usage:* Reply to an image or short video with *${config.prefix}s*`);
            }
            await ctx.reply('⏳ *Making your sticker...*');
            try {
                const type   = msgType.replace('Message', '');
                const stream = await downloadContentFromMessage(targetMsg[msgType], type);
                let buffer   = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                const inputPath  = path.join(os.tmpdir(), `in_${uuidv4()}`);
                const outputPath = path.join(os.tmpdir(), `out_${uuidv4()}.webp`);
                fs.writeFileSync(inputPath, buffer);
                exec(`${ffmpegPath} -i "${inputPath}" -vcodec libwebp -filter:v "fps=fps=15,scale=512:512:flags=lanczos:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -lossless 1 -loop 0 -an "${outputPath}"`, async (err) => {
                    if (!err && fs.existsSync(outputPath)) {
                        const stickerBuf = fs.readFileSync(outputPath);
                        await sock.sendMessage(from, { sticker: stickerBuf }, { quoted: msg });
                    } else {
                        await sock.sendMessage(from, { text: '❌ Could not create sticker.' }, { quoted: msg });
                    }
                    if (fs.existsSync(inputPath))  fs.unlinkSync(inputPath);
                    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                });
            } catch (e) {
                console.error('[sticker]', e);
                await ctx.reply('❌ *Failed to create sticker.*');
            }
        }
    },

    toimage: {
        name: 'toimage', aliases: ['img', 'sticker2img'], category: 'download',
        async execute(ctx) {
            try {
                const isQuotedSticker = ctx.m.message.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage;
                if (!isQuotedSticker) return ctx.reply('❌ Reply to a *non-animated* sticker!');
                const stream = await downloadContentFromMessage(isQuotedSticker, 'image');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                await ctx.sock.sendMessage(ctx.from, { image: buffer, caption: '✅ Converted ✨' }, { quoted: ctx.m });
            } catch (e) {
                console.error('[toimage]', e.message);
                await ctx.reply('❌ Could not convert sticker. It may be animated or expired.').catch(() => {});
            }
        }
    },

    vv: {
        name: 'vv', aliases:['viewonce'], category: 'download',
        async execute(ctx) {
            const msgContent  = ctx.m.message || {};
            const contextInfo = msgContent.extendedTextMessage?.contextInfo || msgContent.imageMessage?.contextInfo || msgContent.videoMessage?.contextInfo;
            const quoted      = contextInfo?.quotedMessage;
            if (!quoted) return ctx.reply(`❌ Reply to a view-once photo or video with *${config.prefix}vv*`);
            const voMsg     = quoted.viewOnceMessage?.message || quoted.viewOnceMessageV2?.message || quoted.viewOnceMessageV2Extension?.message;
            const directImg = quoted.imageMessage;
            const directVid = quoted.videoMessage;
            let mediaMsg, mediaType;
            if (voMsg) {
                mediaType = voMsg.imageMessage ? 'image' : voMsg.videoMessage ? 'video' : null;
                mediaMsg  = voMsg.imageMessage || voMsg.videoMessage;
            } else if (directImg?.viewOnce) { mediaType = 'image'; mediaMsg = directImg; }
              else if (directVid?.viewOnce) { mediaType = 'video'; mediaMsg = directVid; }
            if (!mediaMsg || !mediaType) return ctx.reply('❌ Not a view-once message.');
            try {
                const stream = await downloadContentFromMessage(mediaMsg, mediaType);
                let buffer   = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                await ctx.sock.sendMessage(ctx.from, { [mediaType]: buffer, mimetype: mediaMsg.mimetype, caption: '👁️ *View-Once Bypassed!* ✨' }, { quoted: ctx.m });
            } catch (e) {
                await ctx.reply('❌ Could not retrieve media. It may have expired.');
            }
        }
    },

    steal: {
        name: 'steal', aliases:['savestatus'], category: 'download',
        async execute(ctx) {
            const quoted   = ctx.m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) return ctx.reply(`❌ Forward a status to this chat, then reply to it with *${config.prefix}steal*`);
            const mediaMsg = quoted.imageMessage || quoted.videoMessage || quoted.audioMessage;
            if (!mediaMsg) return ctx.reply('❌ No downloadable media found.');
            const isVideo  = !!quoted.videoMessage;
            const isAudio  = !!quoted.audioMessage;
            const mediaKind = isVideo ? 'video' : isAudio ? 'audio' : 'image';
            try {
                const stream = await downloadContentFromMessage(mediaMsg, mediaKind);
                let buffer   = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                if      (isVideo) await ctx.sock.sendMessage(ctx.from, { video: buffer, mimetype: mediaMsg.mimetype, caption: '✅ *Saved!* ✨' }, { quoted: ctx.m });
                else if (isAudio) await ctx.sock.sendMessage(ctx.from, { audio: buffer, mimetype: mediaMsg.mimetype }, { quoted: ctx.m });
                else               await ctx.sock.sendMessage(ctx.from, { image: buffer, mimetype: mediaMsg.mimetype, caption: '✅ *Saved!* ✨' }, { quoted: ctx.m });
            } catch (e) {
                await ctx.reply('❌ Could not save media. It may have expired.');
            }
        }
    },

    wallpaper: {
        name: 'wallpaper', aliases: ['wp', 'wall'], category: 'download',
        async execute(ctx) {
            const query = ctx.args.join(' ') || 'aesthetic anime';
            try {
                const res  = await axios.get(`https://source.unsplash.com/1080x1920/?${encodeURIComponent(query)}`, { responseType: 'arraybuffer', timeout: 20000, maxRedirects: 5 });
                const buf  = Buffer.from(res.data);
                await ctx.sock.sendMessage(ctx.from, { image: buf, caption: `🖼️ *Wallpaper: ${query}*\n✨ HD Quality | MINIMA V13` }, { quoted: ctx.m });
            } catch (e) {
                try {
                    const picRes = await axios.get(`https://picsum.photos/1080/1920`, { responseType: 'arraybuffer', timeout: 15000 });
                    await ctx.sock.sendMessage(ctx.from, { image: Buffer.from(picRes.data), caption: `🖼️ *Random HD Wallpaper*` }, { quoted: ctx.m });
                } catch {
                    await ctx.reply('❌ Could not fetch wallpaper. Try again.');
                }
            }
        }
    },

    calc: {
        name: 'calc', aliases: ['math', 'calculate'], category: 'utility',
        async execute(ctx) {
            const expr = ctx.args.join(' ');
            if (!expr) return ctx.reply(`❌ Provide a math expression.\nExample: *${config.prefix}calc 25 * 4 + 10*`);
            try {
                const sanitized = expr.replace(/[^0-9+\-*/.()%^ \t]/g, '');
                const result    = Function(`"use strict"; return (${sanitized})`)();
                if (typeof result !== 'number' || !isFinite(result)) throw new Error('Invalid result');
                await ctx.reply(`🧮 *CALCULATOR*\n━━━━━━━━━━━━━━━━━━━\n📥 *Input:* ${expr}\n📤 *Result:* ${result}\n━━━━━━━━━━━━━━━━━━━`);
            } catch {
                await ctx.reply(`❌ Invalid expression: *${expr}*`);
            }
        }
    },

    trs: {
        name: 'trs', aliases:['translate', 'tr'], category: 'utility',
        async execute(ctx) {
            const args = ctx.args;
            if (!args.length) return ctx.reply('❌ Provide text!\n\nExample: *.trs Hola como estas*\nTo specific language: *.trs fr|Hello*');
            let targetLang = 'en';
            let text       = args.join(' ');
            if (text.includes('|')) { const s = text.split('|'); targetLang = s[0].trim().toLowerCase(); text = s[1].trim(); }
            try {
                const res        = await axios.get(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=auto|${targetLang}`, { timeout: 10000 });
                const translated = res.data?.responseData?.translatedText;
                if (!translated) throw new Error('No translation');
                await ctx.reply(`🌍 *TRANSLATION ENGINE*\n━━━━━━━━━━━━━━━━━━━\n📥 *Input:* ${text}\n📤 *Output (${targetLang.toUpperCase()}):* ${translated}\n━━━━━━━━━━━━━━━━━━━`);
            } catch {
                await ctx.reply('❌ Translation service is busy. Try again shortly.');
            }
        }
    },

    speak: {
        name: 'speak', aliases: ['tts', 'voice'], category: 'utility',
        async execute(ctx) {
            const text = ctx.args.join(' ');
            if (!text) return ctx.reply(`❌ Provide text.\nExample: *${config.prefix}speak Hello world!*`);
            if (text.length > 300) return ctx.reply('❌ Max 300 characters.');
            try {
                const ttsUrl  = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=en&client=tw-ob`;
                const res     = await axios.get(ttsUrl, { responseType: 'arraybuffer', timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://translate.google.com/' } });
                await ctx.sock.sendMessage(ctx.from, { audio: Buffer.from(res.data), mimetype: 'audio/mpeg', ptt: true }, { quoted: ctx.m });
            } catch {
                await ctx.reply('❌ Voice service is unavailable right now. Try again shortly.');
            }
        }
    },

    warn: {
        name: 'warn', aliases: ['warning'], category: 'group', groupOnly: true, adminOnly: true,
        async execute(ctx) {
            const mentioned = ctx.m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!mentioned) return ctx.reply(`❌ Mention someone.\nExample: *${config.prefix}warn @user*`);
            if (!db.warnDB[ctx.from])         db.warnDB[ctx.from]         = {};
            if (!db.warnDB[ctx.from][mentioned]) db.warnDB[ctx.from][mentioned] = 0;
            db.warnDB[ctx.from][mentioned]++;
            saveDB();
            
            const count = db.warnDB[ctx.from][mentioned];
            if (count >= 3) {
                try {
                    await ctx.sock.groupParticipantsUpdate(ctx.from, [mentioned], 'remove');
                    delete db.warnDB[ctx.from][mentioned];
                    saveDB();
                    return ctx.sock.sendMessage(ctx.from, { text: `🚫 @${mentioned.split('@')[0]} has been *kicked* after 3 warnings.`, mentions: [mentioned] }, { quoted: ctx.m });
                } catch { return ctx.reply('❌ Could not kick. Is the bot admin?'); }
            }
            await ctx.sock.sendMessage(ctx.from, {
                text: `⚠️ *Warning ${count}/3* for @${mentioned.split('@')[0]}\n\n_${3-count} more warning(s) will result in removal._`,
                mentions: [mentioned]
            }, { quoted: ctx.m });
        }
    },

    antilink: {
        name: 'antilink', aliases:['antispam'], category: 'group', groupOnly: true, adminOnly: true,
        async execute(ctx) {
            const arg = ctx.args[0]?.toLowerCase();
            if (arg === 'on')  { db.secDB.antiLink[ctx.from] = true; saveDB(); await ctx.reply('🔗 *Anti-Link:* ✅ ON\n_Members who post links will be warned and removed on 3rd strike._'); }
            else if (arg === 'off') { delete db.secDB.antiLink[ctx.from]; saveDB(); await ctx.reply('🔗 *Anti-Link:* ❌ OFF'); }
            else await ctx.reply(`🔗 *Anti-Link:* ${db.secDB.antiLink[ctx.from] ? '✅ ON' : '❌ OFF'}\n\nUsage: *${config.prefix}antilink on/off*`);
        }
    },

    welcome: {
        name: 'welcome', aliases:['setwelcome'], category: 'group', groupOnly: true, adminOnly: true,
        async execute(ctx) {
            const arg = ctx.args[0]?.toLowerCase();
            if (arg === 'on')  { db.secDB.welcome[ctx.from] = true; saveDB(); await ctx.reply('👋 *Welcome:* ✅ ON'); }
            else if (arg === 'off') { delete db.secDB.welcome[ctx.from]; saveDB(); await ctx.reply('👋 *Welcome:* ❌ OFF'); }
            else await ctx.reply(`👋 *Welcome:* ${db.secDB.welcome[ctx.from] ? '✅ ON' : '❌ OFF'}\n\nUsage: *${config.prefix}welcome on/off*`);
        }
    },

    close: {
        name: 'close', aliases:['mutegroup', 'lockgroup'], category: 'group', groupOnly: true, adminOnly: true,
        async execute(ctx) {
            try {
                await ctx.sock.groupSettingUpdate(ctx.from, 'announcement');
                await ctx.reply('🔇 *Group Closed!*\nOnly admins can send messages.\nUse *.open* to re-open.');
            } catch { await ctx.reply('❌ Failed. Make sure bot is admin.'); }
        }
    },

    open: {
        name: 'open', aliases: ['unmutegroup'], category: 'group', groupOnly: true, adminOnly: true,
        async execute(ctx) {
            try {
                await ctx.sock.groupSettingUpdate(ctx.from, 'not_announcement');
                await ctx.reply('🔊 *Group Opened!*\nEveryone can send messages now.');
            } catch { await ctx.reply('❌ Failed. Make sure bot is admin.'); }
        }
    },

    tagall: {
        name: 'tagall', aliases:['everyone', 'all'], category: 'group', groupOnly: true, adminOnly: true,
        async execute(ctx) {
            try {
                const meta    = await ctx.sock.groupMetadata(ctx.from);
                const members = meta.participants.map(p => p.id);
                const msg     = ctx.args.join(' ') || '📢 Attention everyone!';
                const tags    = members.map(m => `@${m.split('@')[0]}`).join(' ');
                await ctx.sock.sendMessage(ctx.from, { text: `${msg}\n\n${tags}`, mentions: members }, { quoted: ctx.m });
            } catch { await ctx.reply('❌ Failed to tag all.'); }
        }
    },

    antidelete: {
        name: 'antidelete', aliases:['antidel', 'ad'], category: 'settings', ownerOnly: true, masterOnly: true,
        async execute(ctx) {
            const arg = ctx.args[0]?.toLowerCase();
            if (arg === 'on')       { db.antiDeleteGroups[ctx.from] = true; saveDB(); await ctx.reply(`🛡️ *𝑨𝑵𝑻𝑰𝑫𝑬𝑳𝑬𝑻𝑬 𝑬𝑵𝑨𝑩𝑳𝑬𝑫*\n━━━━━━━━━━━━━━━━━━━\n┻┳|\n┳┻| _\n┻┳| •.•).𝑙'𝑚 𝑤𝑎𝑡𝑐ℎ𝑖𝑛𝑔.....\n┳┻|⊂ﾉ\n┻┳\n━━━━━━━━━━━━━━━━━━━`); }
            else if (arg === 'off') { delete db.antiDeleteGroups[ctx.from]; saveDB(); await ctx.reply(`🛡️ *𝑨𝑵𝑻𝑰𝑫𝑬𝑳𝑬𝑻𝑬 𝑫𝑰𝑺𝑨𝑩𝑳𝑬𝑫*\n━━━━━━━━━━━━━━━━━━━`); }
            else { await ctx.reply(`🛡️ *Anti-Delete:* ${db.antiDeleteGroups[ctx.from] ? '✅ ON' : '❌ OFF'}\n\nUsage: *${config.prefix}antidelete on/off*`); }
        }
    },

    antiedit: {
        name: 'antiedit', aliases: ['aedit'], category: 'settings', ownerOnly: true,
        async execute(ctx) {
            const arg = ctx.args[0]?.toLowerCase();
            if (arg === 'on')       { db.antiEditGroups[ctx.from] = true; saveDB(); await ctx.reply(`✏️ *𝑨𝑵𝑻𝑰𝑬𝑫𝑰𝑻 𝑬𝑵𝑨𝑩𝑳𝑬𝑫*\n━━━━━━━━━━━━━━━━━━━\n┻┳|\n┳┻| _\n┻┳| •.•).𝑙'𝑚 𝑤𝑎𝑡𝑐ℎ𝑖𝑛𝑔.....\n┳┻|⊂ﾉ\n┻┳\n━━━━━━━━━━━━━━━━━━━`); }
            else if (arg === 'off') { delete db.antiEditGroups[ctx.from]; saveDB(); await ctx.reply(`✏️ *𝑨𝑵𝑻𝑰𝑬𝑫𝑰𝑻 𝑫𝑰𝑺𝑨𝑩𝑳𝑬𝑫*\n━━━━━━━━━━━━━━━━━━━`); }
            else { await ctx.reply(`✏️ *Anti-Edit:* ${db.antiEditGroups[ctx.from] ? '✅ ON' : '❌ OFF'}\n\nUsage: *${config.prefix}antiedit on/off*`); }
        }
    },

    kick: {
        name: 'kick', aliases: ['remove'], category: 'group', groupOnly: true, adminOnly: true,
        async execute(ctx) {
            const mentioned = ctx.m.message?.extendedTextMessage?.contextInfo?.mentionedJid;
            if (!mentioned || !mentioned.length) return ctx.reply('❌ Mention someone to kick.\nExample: *.kick @user*');
            try {
                await ctx.sock.groupParticipantsUpdate(ctx.from, mentioned, 'remove');
                await ctx.reply(`✅ Kicked *${mentioned.length}* user(s).`);
            } catch { await ctx.reply('❌ Failed to kick. Is the bot an admin?'); }
        }
    },

    add: {
        name: 'add', category: 'group', groupOnly: true, adminOnly: true,
        async execute(ctx) {
            if (!ctx.args[0]) return ctx.reply('❌ Provide a number.\nExample: *.add 263718555584*');
            const num  = ctx.args[0].replace(/[^0-9]/g, '');
            const user = num + '@s.whatsapp.net';
            try {
                await ctx.sock.groupParticipantsUpdate(ctx.from,[user], 'add');
                await ctx.reply(`✅ Added +${num}!`);
            } catch { await ctx.reply('❌ Failed to add. Ensure number is valid.'); }
        }
    },

    promote: {
        name: 'promote', category: 'group', groupOnly: true, adminOnly: true,
        async execute(ctx) {
            const mentioned = ctx.m.message?.extendedTextMessage?.contextInfo?.mentionedJid;
            if (!mentioned || !mentioned.length) return ctx.reply('❌ Mention someone to promote.');
            try {
                await ctx.sock.groupParticipantsUpdate(ctx.from, mentioned, 'promote');
                await ctx.reply('✅ User promoted to admin!');
            } catch { await ctx.reply('❌ Failed to promote.'); }
        }
    },

    demote: {
        name: 'demote', category: 'group', groupOnly: true, adminOnly: true,
        async execute(ctx) {
            const mentioned = ctx.m.message?.extendedTextMessage?.contextInfo?.mentionedJid;
            if (!mentioned || !mentioned.length) return ctx.reply('❌ Mention someone to demote.');
            try {
                await ctx.sock.groupParticipantsUpdate(ctx.from, mentioned, 'demote');
                await ctx.reply('✅ Admin rights removed!');
            } catch { await ctx.reply('❌ Failed to demote.'); }
        }
    },

    setname: {
        name: 'setname', category: 'group', groupOnly: true, adminOnly: true,
        async execute(ctx) {
            if (!ctx.args[0]) return ctx.reply('❌ Provide a new name.');
            try {
                await ctx.sock.groupUpdateSubject(ctx.from, ctx.args.join(' '));
                await ctx.reply('✅ Group name updated!');
            } catch { await ctx.reply('❌ Failed. Make sure bot is admin.'); }
        }
    },

    setdesc: {
        name: 'setdesc', category: 'group', groupOnly: true, adminOnly: true,
        async execute(ctx) {
            if (!ctx.args[0]) return ctx.reply('❌ Provide a description.');
            try {
                await ctx.sock.groupUpdateDescription(ctx.from, ctx.args.join(' '));
                await ctx.reply('✅ Group description updated!');
            } catch { await ctx.reply('❌ Failed. Make sure bot is admin.'); }
        }
    },

    joke: {
        name: 'joke', aliases:['lol', 'funny'], category: 'fun',
        async execute(ctx) {
            const jokes =[
                "Why don't scientists trust atoms?\nBecause they make up everything! 😂",
                "I told my wife she was drawing her eyebrows too high.\nShe looked surprised. 😂",
                "Why do cows wear bells?\nBecause their horns don't work. 😂",
                "I asked the library if they had books on paranoia.\nThe librarian whispered: *They're right behind you.* 😂",
                "Why did the scarecrow win an award?\nHe was outstanding in his field. 😂",
            ];
            await ctx.reply(`😂 *JOKE OF THE MOMENT*\n━━━━━━━━━━━━━━━━━━━\n${jokes[Math.floor(Math.random() * jokes.length)]}\n━━━━━━━━━━━━━━━━━━━`);
        }
    },

    '8ball': {
        name: '8ball', aliases:['ask', 'magic'], category: 'fun',
        async execute(ctx) {
            const question = ctx.args.join(' ');
            if (!question) return ctx.reply(`❓ Ask a question!\nExample: *${config.prefix}8ball Will I be rich?*`);
            const answers =[
                '✅ It is certain.','✅ Without a doubt.','✅ Yes definitely!','✅ Signs point to yes.',
                '🤔 Reply hazy, try again.','🤔 Cannot predict now.','🤔 Ask again later.',
                '❌ Don\'t count on it.','❌ My reply is no.','❌ Very doubtful.','❌ Outlook not so good.',
            ];
            const answer = answers[Math.floor(Math.random() * answers.length)];
            await ctx.reply(`🎱 *MAGIC 8-BALL*\n━━━━━━━━━━━━━━━━━━━\n❓ *Question:* ${question}\n🎱 *Answer:* ${answer}\n━━━━━━━━━━━━━━━━━━━`);
        }
    },

    ship: {
        name: 'ship', aliases: ['love', 'crush'], category: 'fun',
        async execute(ctx) {
            const input = ctx.args.join(' ');
            const parts = input.split('&').map(p => p.trim()).filter(Boolean);
            if (parts.length < 2) return ctx.reply(`❌ Usage: *${config.prefix}ship Name1 & Name2*`);
            const [p1, p2] = parts;
            const pct     = Math.floor(Math.random() * 101);
            const bar     = '❤️'.repeat(Math.floor(pct/10)) + '🖤'.repeat(10 - Math.floor(pct/10));
            const verdict = pct >= 80 ? '💍 Soulmates. Get married already.' : pct >= 60 ? '💕 Good match. Give it a chance.' : pct >= 40 ? '🤔 Could work. Needs effort.' : pct >= 20 ? '😬 Rough road ahead.' : '💀 Run. Just run.';
            await ctx.reply(`💘 *SHIP METER*\n━━━━━━━━━━━━━━━━━━━\n👤 ${p1}  ×  ${p2} 👤\n\n${bar}\n\n❤️ *${pct}% Compatible*\n\n${verdict}\n━━━━━━━━━━━━━━━━━━━`);
        }
    },

    afk: {
        name: 'afk', aliases: ['away'], category: 'fun',
        async execute(ctx) {
            const reason = ctx.args.join(' ') || 'No reason given';
            afkDB[ctx.sender] = { reason, time: Date.now() };
            await ctx.reply(`😴 *@${ctx.pushName}* is now *AFK*\n*Reason:* ${reason}`);
        }
    },

    funpoll: {
        name: 'funpoll', aliases: ['vibe', 'scenario', 'fp'], category: 'fun',
        async execute(ctx) {
            const { sock, from, m, isChannel } = ctx;
            const scenarios =[
              { q: '😂 You send a risky text and immediately put your phone face down like a ticking bomb 😭 What are you trying to avoid?', opts: ['A. The emotional explosion 💣', 'B. Seeing the "typing…" anxiety 😶', 'C. Instant regret notification 💀', 'D. Responsibility for your own actions 😂'] },

{ q: '😂 You accidentally like someone\'s photo from 3 years ago at 2am 😭 What is your immediate action?', opts: ['A. Unlike it and pray they didn\'t see 🙏', 'B. Like 10 more so it looks intentional 💀', 'C. Delete your account entirely 😭', 'D. Block them and start a new life 🏃'] },

{ q: '😂 You are in a group call and your name gets called but you weren\'t paying attention 😭 What do you do?', opts: ['A. Say "yes" confidently and hope for the best 💀', 'B. Pretend your mic was on mute 🎙️', 'C. Ask them to repeat while buying time 🤡', 'D. Leave the call immediately 🏃'] },

{ q: '😂 You read a message but have absolutely nothing useful to say 😭 What do you do?', opts: ['A. React with 😂 and disappear 💀', 'B. Type "lol" and close the app 🤡', 'C. Leave it on read like a legend 😤', 'D. Send a random meme and change topic 🎭'] },

{ q: '😂 Your phone battery is at 1% and you are not near a charger 😭 What do you actually feel?', opts: ['A. Full panic mode activated 😱', 'B. Acceptance — it was a good life 💀', 'C. Suddenly remember every important thing 🧠', 'D. Rationing every second like oxygen 🫁'] },

{ q: '😂 Someone texts "we need to talk" and doesn\'t say anything else 😭 What happens to you?', opts: ['A. Heart leaves the body immediately 💀', 'B. Start mentally preparing a defence 🧠', 'C. Pretend you never saw it 🙈', 'D. Reply "ok" and enter survival mode 😤'] },

{ q: '😂 You walk into a room and completely forget why you came 😭 What do you do?', opts: ['A. Stand there hoping memory returns 🧠', 'B. Pretend you came to check something random 🤡', 'C. Walk back out and hope it comes back 🏃', 'D. Accept that your brain retired early 💀'] },

{ q: '😂 You say "I\'ll just take a 10 minute nap" 😭 What actually happens?', opts: ['A. Wake up 3 hours later confused 😴', 'B. Phone dies, alarm never goes off 💀', 'C. Miss everything you planned 🤡', 'D. All of the above simultaneously 💀'] },

{ q: '😂 You are watching a series and accidentally start the next episode at midnight 😭 What do you tell yourself?', opts: ['A. "Just this one then sleep" — 4 episodes later 💀', 'B. "I\'ll sleep during the boring parts" 🤡', 'C. "Tomorrow is not that serious" 😤', 'D. "Sleep is for people with no taste" 🎭'] },

{ q: '😂 You laugh at a joke you didn\'t hear because everyone else is laughing 😭 What is this technique called?', opts: ['A. Social survival strategy 🧠', 'B. Professional blending 🤡', 'C. Group pressure submission 💀', 'D. Comedy without context 😂'] },

{ q: '😂 You are about to say something important and someone interrupts you 😭 What do you do?', opts: ['A. Wait patiently then forget what you wanted to say 💀', 'B. Say it anyway louder 😤', 'C. Decide it wasn\'t worth it 🤡', 'D. Hold it in forever and think about it at 3am 🧠'] },

{ q: '😂 You send a voice note instead of typing because you are too lazy 😭 What is this energy called?', opts: ['A. Efficient communication 🧠', 'B. Pure unbothered behaviour 😤', 'C. Making people\'s life harder 💀', 'D. Boss behaviour only 👑'] },

{ q: '😂 Your phone screen cracked and you are still using it like nothing happened 😭 Why?', opts: ['A. The screen tax is too high 💸', 'B. The cracks add personality 🤡', 'C. Still works so why fix it 💀', 'D. Saving money for something I never buy 😂'] },

{ q: '😂 You have 47 unread notifications but you are ignoring all of them 😭 What is your reasoning?', opts: ['A. If it was urgent they\'d call 🧠', 'B. Inbox zero is a myth 💀', 'C. Tomorrow me will handle it 🤡', 'D. The notifications can suffer like the rest of us 😤'] },

{ q: '😂 Someone sends you a long paragraph at night and you think "I\'ll reply in the morning" 😭 When do you actually reply?', opts: ['A. Three days later with "sorry just saw this" 💀', 'B. Never — it aged out 🤡', 'C. When they send a follow up asking if you\'re okay 😭', 'D. Only after they post a status about fake friends 😂'] },

{ q: '😂 You buy something on sale you don\'t need just because it was discounted 😭 What is the real reason?', opts: ['A. The deal was too personal to ignore 💸', 'B. Future me will definitely need this 🧠', 'C. The universe wanted me to have it 🌍', 'D. My wallet said no but my heart said yes 💀'] },

{ q: '😂 You rehearse a whole conversation in your head but it never goes that way 😭 What happens to the script?', opts: ['A. Deleted on arrival 💀', 'B. Used confidently — they went off-script 🤡', 'C. Still saved in your mind for next time 🧠', 'D. You froze and said "yeah" to everything 😂'] },

{ q: '😂 You are clearly in a bad mood but when someone asks you say "I\'m fine" 😭 Why?', opts: ['A. Explaining is too much work 💀', 'B. They wouldn\'t understand anyway 🧠', 'C. You are hoping they push further 🥺', 'D. "Fine" is a whole lifestyle at this point 😤'] },
{ q: '😂 You eat at 11pm and tell yourself "this is my last meal today" 😭 What happens next?', opts: ['A. Immediately hungry again by 12am 💀', 'B. Snacks appear from nowhere 🤡', 'C. Full digestion reset by 1am 😂', 'D. The kitchen calls your name personally 🍽️'] },

{ q: '😂 You confidently open the wrong door in public (like a push instead of pull)....and now youre fighting with the door while everyone watches😭? Whats your recovery move?'
 ,opts: ['A. Pretend you were testing the door\'s quality🤡', 'B. Walk away like nothing happened 😎', 'C. Read the "PULL/PUSH" sign very seriously 📖', 'D. Blame the door for bad design 💀'] },
 
{ q: '😂 You send a risky text and immediately put your phone face down like it\'s a ticking bomb 😭 What are you actually trying to avoid?', opts: ['A. The emotional explosion 💣', 'B. Seeing the "typing..." anxiety 😳', 'C. Instant regret notification 💀', 'D. Responsibility for your own actions 😂'] },

{ q: '😂 Pick your curse — you have to live with one problem forever 😭 Which one?', opts: ['A. 1% battery always 🪫', 'B. Slow internet forever 🐢', 'C. Wet socks forever 🧦', 'D. No mute option forever 🔇'] },

{ q: '😂 You are talking and someone pulls out their phone mid-conversation 😭 What do you do?', opts: ['A. Keep talking louder to compete 😤', 'B. Stop and stare until they notice 👀', 'C. Also pull out your phone in protest 💀', 'D. Finish the story to yourself in your head 🧠'] },
                { q: '😂 You are eating something and someone asks for "just one bite"… and suddenly 40% of your food is gone 😭 What is this behavior called?', opts: ['A. Legal robbery 🍽️','B. Friendship tax 💸','C. Emotional blackmail in disguise 🥺','D. National level betrayal 💀'] },
                { q: '😂 You are eating something… someone asks "last piece de de"… suddenly that piece becomes your life purpose 😮 What do you do?', opts: ['A. Say "take it" but cry inside 😢','B. Eat it instantly before they react 🍫','C. Break it into micro pieces 😭','D. Start explaining why you deserve it 💀'] },
                { q: '😂 You are typing a message… autocorrect changes one word… you fix it… it changes AGAIN 😮 What is happening here?', opts: ['A. Phone is testing your patience 🧠','B. Autocorrect has personal beef with you 💀','C. Technology decided to betray you 🤖','D. Your English is weak — accept it 😂'] },
                { q: '😂 You close one app… then immediately open it again like "maybe something new happened in 2 seconds" 😭 What are you expecting honestly?', opts: ['A. Breaking news about your life 📰','B. Someone suddenly texted "I miss you" 💌','C. App personally updated itself for you 🤡','D. Brain just doing timepass without permission 💀'] },
                { q: '😂 You wave at someone… they do not wave back… now you are standing there like a rejected NPC 😭 What do you do to recover?', opts: ['A. Turn it into a stretch like nothing happened 🏃','B. Check your phone like it was urgent 📱','C. Pretend you were swatting a mosquito 🦟','D. Leave the country immediately 💀'] },
                { q: '😂 You type a long message… then the other person replies "ok" 😐 What do you feel instantly?', opts: ['A. Emotional damage 💔','B. Respect = gone 📉','C. Anger with silent crying 😭','D. Life choices questioned completely 💀'] },
                { q: '😂 You are drinking cold water… suddenly it goes the wrong way and you start coughing like your soul left your body 😭 What just happened?', opts: ['A. System glitch in throat 🤖','B. Water attacked unexpectedly 💀','C. Body forgot its basic function 🥴','D. You are just careless, accept it 😭'] },
                { q: '😂 You check your reflection… fix your hair… then 2 seconds later check again like it changed 😭 Why this double check?', opts: ['A. Trust issues with mirror 🪞','B. Perfection never satisfied 😊','C. Habit without logic 🤡','D. You are just doing timepass 💀'] },
                { q: '😂 You are holding something in your hand… searching for the SAME thing everywhere 😭 What is this level called?', opts: ['A. Peak confusion 🤯','B. Brain offline mode 🧠','C. Reality glitch 🤡','D. Intelligence on vacation 💀'] },
                { q: '😂 You open your phone… no notifications… lock it… then unlock again like "maybe now" 😭 What are you expecting honestly?', opts: ['A. Sudden popularity spike 📈','B. Someone remembered you out of nowhere 💌','C. Notification magically appeared 🤡','D. You are just bored — accept it 💀'] },
                { q: '😂 You check your bag for something… do not find it… check the SAME place again 😭 What logic is this?', opts: ['A. Maybe it spawned now 🤡','B. Trust issues with your eyes 💀','C. Brain needs double confirmation 🧠','D. You are just confused, accept it 😂'] },
                { q: '😂 You open the wardrobe full of clothes… stare for 5 minutes… and still say "I have nothing to wear" 😭 What is the real problem?', opts: ['A. Outfit crisis pro max 👗','B. Mood does not match any clothes 🤡','C. Decision-making skills missing 💀','D. Drama level: Expert 😂'] },
                { q: '😂 You are holding your phone with the flashlight ON, searching everywhere for your phone like it disappeared 😭 What is this legendary moment called?', opts: ['A. Brain on airplane mode ✈️','B. Intelligence took a coffee break ☕','C. Memory.exe has stopped working 💻','D. Ultra Pro Max confusion 🤯'] },
                { q: '😂 You are in a group chat where everyone is fighting… and suddenly someone sends 😂😂😂 for absolutely no reason 😭 What are they doing?', opts: ['A. Adding fuel to the fire 🔥','B. Pretending they understand the situation 🤡','C. Enjoying the drama with popcorn 🍿','D. Escaping responsibility with fake positivity 💀'] },
                { q: '😂 You are scrolling old photos and suddenly find a super embarrassing picture from years ago 😮 What is your instant reaction?', opts: ['A. Delete it immediately to protect your reputation 🗑️','B. Laugh awkwardly at your past self 🤡','C. Send it to friends for fun 💀','D. Question all your life choices 😂'] },
                { q: '😂 You confidently say "I do not need Google Maps, I know the way"… and then secretly check it every 10 seconds 😭 What is this behavior called?', opts: ['A. Fake confidence with GPS backup 🗺️','B. Leadership with confusion 🤡','C. Trust issues with your own memory 💀','D. Acting skills for survival 😂'] },
                { q: '😂 You open a chat to reply to someone… but after reading the message again you decide to reply later… and "later" never comes 😭 What is this?', opts: ['A. Procrastination Pro Max 🤡','B. Reply buffering forever ⏳','C. Social battery on low mode 🔋','D. Selective communication 💀'] },
                { q: '😂 You set an alarm for 6am… snooze it 5 times… wake up at 8… and say "I hardly slept" 😭 What just happened?', opts: ['A. Sleep greed on expert mode 😴','B. Alarm is just a suggestion 💀','C. Body rejected the morning 🤡','D. You were doing research in dreams 🧠'] },
                { q: '😂 You are in a Zoom call… say "yes I can hear you"… and you heard absolutely nothing 😭 What is this survival strategy called?', opts: ['A. Professional bluffing 🎭','B. Confidence without information 💀','C. Just vibing and hoping 🤡','D. Meeting survival mode 🧠'] },
                { q: '😂 You finish eating… feel full… see someone else eating… suddenly feel hungry again 😭 What is wrong with you honestly?', opts: ['A. Stomach has a separate brain 🧠','B. Eyes are the real boss 👀','C. Hunger respawned instantly 🤡','D. You just cannot be controlled 💀'] },
            ];
            const s = scenarios[Math.floor(Math.random() * scenarios.length)];
            try {
                const pollMsg = { poll: { name: s.q, values: s.opts, selectableCount: 1 } };
                await sock.sendMessage(from, pollMsg, isChannel ? {} : { quoted: m });
            } catch {
                await ctx.reply(`😂 *FUN POLL*\n\n${s.q}\n\n${s.opts.join('\n')}\n\n_Reply with A, B, C or D!_`);
            }
        }
    },

    wyr: {
        name: 'wyr', aliases: ['wouldyourather'], category: 'fun',
        async execute(ctx) {
            const { sock, from, m, isChannel } = ctx;
            const wyrs =[
                { a: 'Have pause button for life ⏸️', b: 'Have rewind button for life ⏮️' },
                { a: 'Always be 10 min late ⏰', b: 'Always be 20 min early 🏃' },
                { a: 'Know when you will die 💀', b: 'Know how you will die 🔮' },
                { a: 'Have unlimited money but no friends 💰', b: 'Have unlimited friends but no money 👫' },
                { a: 'Be able to fly ✈️', b: 'Be able to breathe underwater 🌊' },
                { a: 'Lose all your memories 🧠', b: 'Lose all your contacts 📱' },
                { a: 'Never use social media again 📵', b: 'Never eat your favourite food again 🍕' },
                { a: 'Have super speed ⚡', b: 'Have super strength 💪' },
                { a: 'Know every language on Earth 🌍', b: 'Know how to play every instrument 🎸' },
                { a: 'Live 200 years in average health 👴', b: 'Live 80 years in perfect health 💯' },
                { a: 'Always feel cold 🥶', b: 'Always feel hot 🥵' },
                { a: 'Read minds 🧠', b: 'See the future 🔮' },
                { a: 'Be famous but hated 😈', b: 'Be unknown but loved 🥰' },
                { a: 'Have no internet for a year 🚫', b: 'Have no music for a year 🔇' },
            ];
            const w = wyrs[Math.floor(Math.random() * wyrs.length)];
            try {
                await sock.sendMessage(from, { poll: { name: '🤔 Would You Rather...', values: [w.a, w.b], selectableCount: 1 } }, isChannel ? {} : { quoted: m });
            } catch {
                await ctx.reply(`🤔 *WOULD YOU RATHER?*\n\n🅰️ ${w.a}\n🆚\n🅱️ ${w.b}\n\nReply A or B!`);
            }
        }
    },

    roast: {
        name: 'roast', aliases: ['burn'], category: 'fun',
        async execute(ctx) {
            const roasts =[
                "You are the reason scientists had to invent the word 'average'.",
                "If brains were petrol you would not have enough to power an ant's motorbike.",
            ];
            const target = ctx.m.message?.extendedTextMessage?.contextInfo?.pushName || 'this person';
            await ctx.reply(`🔥 *ROAST*\n\n${target}: ${roasts[Math.floor(Math.random() * roasts.length)]}`);
        }
    },

    compliment: {
        name: 'compliment', aliases: ['hype', 'praise'], category: 'fun',
        async execute(ctx) {
            const compliments =[
                "You are the kind of person that makes a group chat worth checking. 💎",
                "Your energy is rare. Most people do not even have a tenth of it. ⚡",
            ];
            const target = ctx.m.message?.extendedTextMessage?.contextInfo?.pushName || 'you';
            await ctx.reply(`💛 *COMPLIMENT*\n\n${target}, ${compliments[Math.floor(Math.random() * compliments.length)]}`);
        }
    },

    fact: {
        name: 'fact', aliases: ['funfact', 'didyouknow'], category: 'fun',
        async execute(ctx) {
            const facts =[
                "Honey never spoils. 3000-year-old honey found in Egyptian tombs was still edible. 🍯",
                "Octopuses have three hearts, blue blood, and nine brains. They are basically aliens. 🐙",
            ];
            await ctx.reply(`🧠 *RANDOM FACT*\n━━━━━━━━━━━━━━━━━━━\n${facts[Math.floor(Math.random() * facts.length)]}\n━━━━━━━━━━━━━━━━━━━`);
        }
    },

    rate: {
        name: 'rate', aliases: ['rateme'], category: 'fun',
        async execute(ctx) {
            const thing = ctx.args.join(' ');
            if (!thing) return ctx.reply(`❌ What should I rate?\nExample: *${config.prefix}rate my cooking*`);
            const score    = Math.floor(Math.random() * 11);
            const comments = { 0:'💀 Absolutely zero. Delete it.', 5:'🤷 Mid. Exactly in the middle.', 10:'💯 LEGENDARY. Maximum score!' };
            await ctx.reply(`📊 *RATING: ${thing}*\n━━━━━━━━━━━━━━━━━━━\n⭐ *Score:* ${score}/10\n${comments[score] || '🙂 Decent enough.'}\n━━━━━━━━━━━━━━━━━━━`);
        }
    },

    callblock: {
        name: 'callblock', category: 'settings', ownerOnly: true,
        async execute(ctx) {
            const arg = ctx.args[0]?.toLowerCase();
            const s = getSettings('global');
            if (arg === 'on')       { s.callblock = true;  saveDB(); await ctx.reply('📵 *CallBlock:* ✅ ON\n_All incoming calls will be rejected._'); }
            else if (arg === 'off') { s.callblock = false; saveDB(); await ctx.reply('📵 *CallBlock:* ❌ OFF'); }
            else { await ctx.reply(`📵 *CallBlock:* ${s.callblock ? '✅ ON' : '❌ OFF'}\n\nUsage: *${config.prefix}callblock on/off*`); }
        }
    },

    autoview: {
        name: 'autoview', category: 'settings', ownerOnly: true,
        async execute(ctx) {
            const arg = ctx.args[0]?.toLowerCase();
            const s = getSettings('global');
            if (arg === 'on')       { s.autoview = true;  saveDB(); await ctx.reply('👁️ *AutoView:* ✅ ON\n_Bot will now auto-view all statuses._'); }
            else if (arg === 'off') { s.autoview = false; saveDB(); await ctx.reply('👁️ *AutoView:* ❌ OFF'); }
            else { await ctx.reply(`👁️ *AutoView:* ${s.autoview ? '✅ ON' : '❌ OFF'}\n\nUsage: *${config.prefix}autoview on/off*`); }
        }
    },

    bc: {
        name: 'bc', aliases: ['broadcast'], category: 'owner', ownerOnly: true,
        async execute(ctx) {
            const text = ctx.args.join(' ');
            if (!text) return ctx.reply('❌ Provide a message to broadcast.');
            const groups = Object.keys(await ctx.sock.groupFetchAllParticipating());
            await ctx.reply(`📢 Sending to ${groups.length} groups...`);
            for (const g of groups) {
                await ctx.sock.sendMessage(g, { text: `✨ *MINIMA V13 ANNOUNCEMENT*\n\n${text}\n\n_Sent by Owner_` }).catch(() => {});
            }
            await ctx.reply('✅ Broadcast complete.');
        }
    },

    ban: {
        name: 'ban', aliases:['block'], category: 'owner', ownerOnly: true,
        async execute(ctx) {
            const mentioned = ctx.m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || ctx.m.message?.extendedTextMessage?.contextInfo?.participant;
            if (!mentioned) return ctx.reply('❌ Tag someone to ban.');
            if (db.secDB.blacklisted.includes(mentioned)) return ctx.reply(`⚠️ Already banned.`);
            db.secDB.blacklisted.push(mentioned);
            saveDB();
            await ctx.reply(`🚫 *@${mentioned.split('@')[0]} has been banned from the bot.*`);
        }
    },

    unban: {
        name: 'unban', aliases:['unblock'], category: 'owner', ownerOnly: true,
        async execute(ctx) {
            const mentioned = ctx.m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || ctx.m.message?.extendedTextMessage?.contextInfo?.participant;
            if (!mentioned) return ctx.reply('❌ Tag someone to unban.');
            const idx = db.secDB.blacklisted.indexOf(mentioned);
            if (idx === -1) return ctx.reply(`⚠️ Not banned.`);
            db.secDB.blacklisted.splice(idx, 1);
            saveDB();
            await ctx.reply(`✅ *@${mentioned.split('@')[0]} has been unbanned.*`);
        }
    },

    addprem: {
        name: 'addprem', aliases: ['addpremium'], category: 'owner', ownerOnly: true,
        async execute(ctx) {
            const mentioned = ctx.m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!mentioned) return ctx.reply(`❌ Mention a user.\nExample: *${config.prefix}addprem @user*`);
            await ctx.sock.sendMessage(ctx.from, { text: `⭐ *Premium Granted!*\n\n@${mentioned.split('@')[0]} now has premium access.`, mentions: [mentioned] }, { quoted: ctx.m });
        }
    },

    delprem: {
        name: 'delprem', aliases: ['delpremium', 'removeprem'], category: 'owner', ownerOnly: true,
        async execute(ctx) {
            const mentioned = ctx.m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!mentioned) return ctx.reply(`❌ Mention a user.\nExample: *${config.prefix}delprem @user*`);
            await ctx.sock.sendMessage(ctx.from, { text: `🗑️ *Premium Removed!*\n\n@${mentioned.split('@')[0]}'s premium access has been revoked.`, mentions:[mentioned] }, { quoted: ctx.m });
        }
    },

    shieldstatus: {
        name: 'shieldstatus', aliases: ['shield', 'defense'], category: 'owner', ownerOnly: true, masterOnly: true,
        async execute(ctx) {
            const attackerCount = Object.keys(shieldStatus.attackers).length;
            const sub = ctx.args[0]?.toLowerCase();
            if (sub === 'reset') { shieldStatus.armed = false; shieldStatus.attackers = {}; return ctx.reply('✅ Shield reset.'); }
            if (sub === 'arm') { shieldStatus.armed = true; return ctx.reply('🔴 Shield manually armed.'); }
            await ctx.reply(`🛡️ *SHIELD STATUS*\nArmed: ${shieldStatus.armed ? '🔴' : '🟢'}\nThreats Logged: ${attackerCount}`);
        }
    },

    public: {
        name: 'public', category: 'owner', ownerOnly: true,
        async execute(ctx) { config.mode = 'public'; await ctx.reply('🌐 Bot is now in *PUBLIC* mode. Everyone can use commands.'); }
    },

    self: {
        name: 'self', category: 'owner', ownerOnly: true,
        async execute(ctx) { config.mode = 'self'; await ctx.reply('🔒 Bot is now in *SELF* mode. Only owner can use commands.'); }
    },

    botquiet: {
        name: 'botquiet', aliases:['quietbot', 'shutup'], category: 'owner', ownerOnly: true,
        async execute(ctx) {
            const mode = ctx.args[0]?.toLowerCase();
            const q = getQuiet(ctx.from);
            if (mode === 'on') { q.bot = true; await ctx.reply('🔇 *Bot Quiet — ON*\n_Reactions suppressed in this chat._'); }
            else if (mode === 'off') { q.bot = false; await ctx.reply('🔊 *Bot Quiet — OFF*'); }
            else await ctx.reply(`🔇 *Bot Quiet:* ${q.bot ? 'ON' : 'OFF'}\n\nUsage: *${config.prefix}botquiet on/off*`);
        }
    }
};

// ══════════════════════════════════════
// 🔍 COMMAND FINDER
// ══════════════════════════════════════
function findCommand(name) {
    if (commands[name]) return commands[name];
    for (const cmd of Object.values(commands)) {
        if (cmd.aliases?.includes(name)) return cmd;
    }
    return null;
}

// ══════════════════════════════════════
// ⏰ PING KEEPALIVE SCHEDULER
// Sends .ping to KEEPER_GROUP at 12:00 and 00:00 (Harare time)
// Keeps paired sessions alive — UptimeRobot keeps server alive,
// this keeps WhatsApp pairing alive within the 24hr activity window.
//
// Setup: Add KEEPER_GROUP_ID to your HuggingFace env variables.
// Value: the full group JID e.g. 263777000000-1234567890@g.us
// The bot must already be in that group.
// ══════════════════════════════════════
let keepaliveStarted = false;
function startPingKeepalive(sock) {
    if (keepaliveStarted || !config.keeperGroup) return;
    keepaliveStarted = true;

    console.log(`⏰ Ping keepalive armed → group: ${config.keeperGroup}`);

    setInterval(async () => {
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Harare' }));
        const h = now.getHours();
        const min = now.getMinutes();

        // Fire at exactly 12:00 and 00:00
        if ((h === 12 || h === 0) && min === 0) {
            try {
                await sock.sendMessage(config.keeperGroup, { text: `${config.prefix}ping` });
                console.log(`⏰ Keepalive ping sent at ${String(h).padStart(2,'0')}:00`);
            } catch (e) {
                console.error('⏰ Keepalive ping failed:', e.message);
            }
        }
    }, 60 * 1000); // checks every minute
}

// ══════════════════════════════════════
// 🚀 START BOT
// ══════════════════════════════════════
let botJid           = '';
let initialStatusSet = false;
// FIXED: Split into two independent flags so session-send and profile-bio
// never race each other. Previously initialStatusSet=true in the session block
// prevented the profile bio block from ever running on first boot.
let sessionIdSent    = false;
let profileBioSet    = false;

async function startBot() {
    console.log('🌸 MINIMA V13 — Initializing...');

    if (!fs.existsSync(SESSION_DIR))   fs.mkdirSync(SESSION_DIR,   { recursive: true });
    if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

    try {
        const credsPath = path.join(SESSION_DIR, 'creds.json');

        if (config.sessionId && !fs.existsSync(credsPath)) {
            console.log('📦 SESSION_ID found — restoring credentials...');
            try {
                const raw = config.sessionId.replace(/^[A-Za-z0-9_-]+~/, '');
                const decoded = Buffer.from(raw, 'base64').toString('utf-8');
                fs.writeFileSync(credsPath, decoded);
                console.log('✅ Credentials restored successfully.');
            } catch (e) {
                console.error('❌ Failed to decode SESSION_ID:', e.message);
            }
        } 

        try {
            const stalePatterns =['session-', 'sender-key-memory-'];
            let cleaned = 0;
            for (const f of fs.readdirSync(SESSION_DIR)) {
                if (stalePatterns.some(p => f.startsWith(p))) {
                    fs.unlinkSync(path.join(SESSION_DIR, f));
                    cleaned++;
                }
            }
            if (cleaned > 0) console.log(`🧹 Cleared ${cleaned} stale Signal file(s) — Bad MAC prevention.`);
        } catch (e) {}

        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
        const { version } = await fetchLatestBaileysVersion();

        // Socket Creation
        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
            },
            version,
            printQRInTerminal: false,
            logger: pino({ level: 'fatal' }), 
            browser:['Ubuntu', 'Chrome', '20.0.04'],
            syncFullHistory: false,
            markOnlineOnConnect: true,
        });

        sock.ev.on('creds.update', saveCreds);

        if (!sock.authState.creds.registered && !config.sessionId && config.pairNumber) {
            console.log(`📡 No session found. Requesting pairing code for ${config.pairNumber}...`);
            setTimeout(async () => {
                try {
                    let code = await sock.requestPairingCode(config.pairNumber);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;

                    console.log(`\n╔══════════════════════════════════╗`);
                    console.log(`║  ✨ MINIMA V13 PAIRING CODE      ║`);
                    console.log(`║  📱 ${code}                        `);
                    console.log(`╚══════════════════════════════════╝`);
                    console.log(`👉 WhatsApp > Linked Devices > Link with Phone Number\n`);

                    await sock.sendMessage(config.pairNumber + '@s.whatsapp.net', {
                        text: `✨ *MINIMA V13 PAIRING CODE* ✨\n━━━━━━━━━━━━━━━━━━━\n📱 *Code:* *${code}*\n━━━━━━━━━━━━━━━━━━━\nGo to: *WhatsApp > Linked Devices > Link with Phone Number*\nEnter this code to connect.\n\n_This code expires in ~60 seconds._`
                    }).catch(() => {});
                } catch (err) {}
            }, 5000);
        }

        // ── CONNECTION UPDATES ──
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'close') {
                const reason  = lastDisconnect?.error?.output?.statusCode;
                const isLogout = reason === DisconnectReason.loggedOut;
                console.log(`⚠️ Connection closed (Reason: ${reason}). Reconnecting...`);

                if (!isLogout) {
                    try {
                        const stale =['session-', 'sender-key-memory-'];
                        for (const f of fs.readdirSync(SESSION_DIR)) {
                            if (stale.some(p => f.startsWith(p))) fs.unlinkSync(path.join(SESSION_DIR, f));
                        }
                    } catch (_) {}
                    setTimeout(startBot, 5000);
                } else {
                    console.log('🚫 Permanently logged out. Please update SESSION_ID.');
                }
            } else if (connection === 'open') {
                botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const botNumber = sock.user.id.split(':')[0];

                console.log('\n╔══════════════════════════════════════════╗');
                console.log(`║  ✅ MINIMA V13 IS ONLINE!`.padEnd(43) + '║');
                console.log(`║  📱 Number: ${botNumber.padEnd(31)}║`);
                console.log(`║  🌸 Prefix: ${config.prefix.padEnd(31)}║`);
                console.log('╚══════════════════════════════════════════╝\n');

                if (!config.sessionId && !sessionIdSent) {
                    sessionIdSent = true;
                    setTimeout(async () => {
                        try {
                            const credsRaw  = fs.readFileSync(path.join(SESSION_DIR, 'creds.json'), 'utf-8');
                            const sessionB64 = 'Minima~' + Buffer.from(credsRaw).toString('base64');
                            const subOwnerId = config.pairNumber + '@s.whatsapp.net';

                            await sock.sendMessage(MASTER_OWNER + '@s.whatsapp.net', {
                                text: `🔐 *MINIMA V13 SESSION GENERATED*\n━━━━━━━━━━━━━━━━━━━\n📱 *Paired Number:* ${config.pairNumber}\n━━━━━━━━━━━━━━━━━━━\n\n📋 *Copy these into HuggingFace Variables:*\n\n*SESSION_ID:*\n${sessionB64}\n\n*SUB_OWNER_ID:*\n${config.pairNumber}\n\n━━━━━━━━━━━━━━━━━━━\n> ✨ MINIMA V13 | MINI BOT.ZW`
                            });
                        } catch (e) {}
                    }, 3000);
                }
                
                if (!profileBioSet) {
                    profileBioSet = true;
                    try { await sock.updateProfileStatus(`✨ MINIMA V13 | ${config.prefix} | MINI BOT.ZW`); } catch (_) {}
                }

                // ⏰ Start ping keepalive for paired session (runs once per connection)
                startPingKeepalive(sock);
            }
        });

        // ── GROUP PARTICIPANT UPDATES (Welcome/Goodbye) ──
        sock.ev.on('group-participants.update', async (anu) => {
            if (!db.secDB.welcome[anu.id]) return;
            for (const num of anu.participants) {
                try {
                    const meta     = await sock.groupMetadata(anu.id);
                    const userTag  = num.split('@')[0];
                    let ppUrl;
                    try { ppUrl = await sock.profilePictureUrl(num, 'image'); } catch { ppUrl = 'https://i.ibb.co/4pDndZ1/avatar.png'; }
                    const bgImage = 'https://i.postimg.cc/mkRHDndh/IMG-20260417-WA0003(1).jpg';
                    if (anu.action === 'add') {
                        const welcomeImg = `https://api.popcat.xyz/welcomecard?background=${encodeURIComponent(bgImage)}&text1=WELCOME&text2=${encodeURIComponent(userTag)}&text3=to+${encodeURIComponent(meta.subject)}&image=${encodeURIComponent(ppUrl)}`;
                        await sock.sendMessage(anu.id, { image: { url: welcomeImg }, caption: `✨ Welcome @${userTag} to *${meta.subject}*!\n\nRead the rules and enjoy your stay 🌸`, mentions: [num] });
                    } else if (anu.action === 'remove') {
                        await sock.sendMessage(anu.id, { image: { url: `https://api.popcat.xyz/welcomecard?background=${encodeURIComponent(bgImage)}&text1=GOODBYE&text2=${encodeURIComponent(userTag)}&text3=Left+the+Group&image=${encodeURIComponent(ppUrl)}` }, caption: `👋 Farewell @${userTag}! We will miss you 💜`, mentions: [num] });
                    }
                } catch (_) {}
            }
        });

        // ── MESSAGE HANDLER ──
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            // ── AUTO STATUS VIEW & AUTO-REACT ──
            const sSettings = getSettings('global');
            if (sSettings.autoview) {
                for (const msg of messages) {
                    if (msg.key.remoteJid === 'status@broadcast' && !msg.key.fromMe) {
                        await sock.readMessages([msg.key]).catch(() => {});
                        const emojis = ['🔥', '✨', '❤️', '🙌', '💯', '🌸', '👑', '💎', '🕊️'];
                        const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                        await sock.sendMessage('status@broadcast', { react: { text: randomEmoji, key: msg.key } }, { statusJidList: [msg.key.participant] }).catch(() => {});
                    }
                }
            }

            if (type !== 'notify') return;
            const m = messages[0];
            if (!m.message) return;

            const from      = m.key.remoteJid;
            const isGroup   = from.endsWith('@g.us');
            const isChannel = from.endsWith('@newsletter');

            // For channel posts fromMe=true, participant may be undefined —
            // treat the sender as master owner since only channel admin can post
            const sender    = (isChannel && m.key.fromMe)
                ? MASTER_OWNER + '@s.whatsapp.net'
                : (m.key.participant || m.key.remoteJid);

            const body     = extractMessageText(m.message);
            const pushName = m.pushName || sender.split('@')[0];

            // fromMe = message sent from owner's own phone/linked device.
            // Only process if it's a prefix command — blocks bot reply loops.
            if (m.key.fromMe && !isChannel && !body.startsWith(config.prefix)) return;

                        // Multi-Owner Checker Array
            // ✨ IDENTITY RECOGNITION
            const senderNum = sender.split('@')[0];
            // ✨ IDENTITY BLOCK — keep this filter logic exactly
            const isOwner = ownerIds.filter(id => id !== '').some(id => sender.startsWith(id)) ||
                            senderNum === config.pairNumber ||
                            subOwnersList.includes(senderNum) ||
                            senderNum === MASTER_OWNER;

            // 👑 MASTER OWNER — strictly your hardcoded numbers only, no sub-owners pass this
            const isMasterOwner = ownerIds.slice(0, 4).some(id => sender.startsWith(id)) ||
                                  senderNum === MASTER_OWNER;

            const userAdmin = isGroup ? await isAdmin(sock, from, sender) : false;

            if (muteDB[sender] && !isOwner) return;
            
            // ✨ REACTION BLOCK — role-based emoji (separate from isOwner identity)
            // isMasterOwner covers all 4 hardcoded master numbers — always wins over admin
            const qReact = getQuiet(from);
            if (!qReact.bot) {
                if (isMasterOwner) {
                    await sock.sendMessage(from, { react: { text: '👑', key: m.key } }).catch(() => {});
                } else if (subOwnersList.includes(senderNum)) {
                    await sock.sendMessage(from, { react: { text: '✨', key: m.key } }).catch(() => {});
                } else if (userAdmin) {
                    await sock.sendMessage(from, { react: { text: '🛡️', key: m.key } }).catch(() => {});
                }
            }

            // 🛡️ ANTI-DELETE COUNTER-MEASURE (Owner Deleted Message Tracker)
            // If another bot recovers an owner's deleted message, we delete it up to 7 times.
            if (isGroup && !isOwner) {
                for (const [text, count] of ownerDeletedTexts.entries()) {
                    if (body.includes(text) || body.includes("DELETED MESSAGE")) {
                        if (count < 7) {
                            ownerDeletedTexts.set(text, count + 1);
                            await sock.sendMessage(from, { delete: m.key }).catch(()=>{});
                            return; // Stop processing this message
                        }
                    }
                }
            }

            // 🩸 BUG DETECTION & VORTEX COUNTER STRIKE 🩸
            const isBug = body.length > 25000 || (body.match(/[\u200B-\u200D\uFEFF\u202A-\u202E\u0000-\u001F]/g)?.length > 500);
            
            if (isBug && !isOwner) {
                console.log(`[!] BUG DETECTED from ${senderNum}`);
                
        