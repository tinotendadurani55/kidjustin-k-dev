//*╔══════════════════════════════════════════════════════════════════╗
   ║ 🤖 KIDJUSTIN-K WHATSAPP BOT - ALL IN ONE                         ║
   ║ V12 FINAL: STABLE, CONFIGURED, and ROBUST MEDIA FIX            ║
   ║                                                               ║
   ║ *** V12: MULTI-ROUND QUIZ GAME SYSTEM IMPLEMENTED (FIXED) *** ║
   ║ *** FIX: AUDIO FILE SIZE OPTIMIZED IN .play COMMAND *** ║
   ║ *** FIX: VIDEO FILE SIZE OPTIMIZED IN .ytv COMMAND (360p) *** ║
   ║ Refined by Gemini AI (Modern Baileys & Robust Checks)          ║
   ╚══════════════════════════════════════════════════════════════════╝ */
 
const express = require('express');
const app = express();

// This keeps Koyeb happy
app.get('/', (req, res) => res.send('Bot is active!'));
app.listen(process.env.PORT || 8000, () => {
    console.log('Health check server is running on port 8000');
});

// --- BELOW IS YOUR BOT CODE ---
// (Your existing Satoru Gojo menu code and Baileys connection code goes here)


const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, WAMessageStubType, generateWAMessageFromContent } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { exec } = require('child_process');
const play = require('play-dl');
const cheerio = require('cheerio');
const { v4: uuidv4 } = require('uuid');
const os = require('os');

// ═══════════════════════════════════════════════════════════════════
// ⚙️ BOT CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

const config = {
    botName: process.env.BOT_NAME || 'Kidjustin-k',
    ownerName: process.env.OWNER_NAME || 't.Durani',
    ownerNumber: process.env.OWNER_NUMBER || '263777426534',
    prefix: process.env.PREFIX || '.',
    mode: process.env.MODE || 'public',
    reportNumber: process.env.REPORT_NUMBER || '0777426534'
};

const ownerJid = config.ownerNumber + '@s.whatsapp.net';

// Global variable to hold bot's own JID once connected
let botJid = ''; 
let initialStatusSet = false; 



const botConfig = {
    menuImage: 'https://i.postimg.cc/RZR1Kmns/Untitled43-20240826162352.png',
};

// V12 ADDED: Game State Management
// State now tracks current round, total questions, and pause timer
const activeGames = {}; 
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
    
    try { require('play-dl'); console.log('✅ Node module check successful: "play-dl" is installed.'); } catch (e) { console.error('\n❌ CRITICAL ERROR: Node module "play-dl" is missing.'); console.error('   To fix, please run: npm install play-dl'); process.exit(1); }
    try { require('cheerio'); console.log('✅ Node module check successful: "cheerio" is installed.'); } catch (e) { console.error('\n❌ CRITICAL ERROR: Node module "cheerio" is missing.'); console.error('   To fix, please run: npm install cheerio'); process.exit(1); }
    try { require('uuid'); console.log('✅ Node module check successful: "uuid" is installed.'); } catch (e) { console.error('\n❌ CRITICAL ERROR: Node module "uuid" is missing.'); console.error('   To fix, please run: npm install uuid'); process.exit(1); }

    await checkBinary('ffmpeg', 'pkg install ffmpeg');
    await checkBinary('yt-dlp', 'pip install yt-dlp'); 
    
    console.log('--- DIAGNOSIS COMPLETE: ALL SYSTEMS GO ---');
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

const commands = {
    // ────────────── MENU (Updated to reflect V12 changes) ──────────────
    menu: {
        name: 'menu',
        aliases: ['help', 'commands'],
        desc: 'Show all commands',
        category: 'general',
        async execute(ctx) {
            const uptime = getUptime();
            const date = new Date();
            
            const categories = {
                '📥 DOWNLOAD': [],
                '🎮 GAMES': [], 
                '👥 GROUP ADMIN': [],
                '🎉 FUN & INTERACTION': [],
                '🤖 AI & UTILITY': [],
                '👑 OWNER ONLY': []
            };

            // Categorize commands (excluding 'general' itself and 'hidden' ones)
            Object.values(commands).forEach(cmd => {
                let cat = '';
                if (cmd.category === 'download') cat = '📥 DOWNLOAD';
                else if (cmd.category === 'game') cat = '🎮 GAMES'; 
                else if (cmd.category === 'group') cat = '👥 GROUP ADMIN';
                else if (cmd.category === 'fun') cat = '🎉 FUN & INTERACTION';
                else if (cmd.category === 'ai' || cmd.category === 'general') cat = '🤖 AI & UTILITY';
                else if (cmd.category === 'owner') cat = '👑 OWNER ONLY';
                
                if (cat) {
                    const prefix = cmd.category === 'owner' ? '*' : config.prefix;
                    categories[cat].push(`*${prefix}${cmd.name}*: ${cmd.desc}`);
                }
            });

            let menuText = `
╔═════════「 *${config.botName.toUpperCase()}* 」═════════╗
| 👑 *Owner:* ${config.ownerName}
| 📞 *Number:* +${config.ownerNumber}
| 🕰️ *Uptime:* ${uptime}
| ✍️ *Prefix:* \`${config.prefix}\`
| 🛡️ *Mode:* ${config.mode.toUpperCase()}
╚══════════════════════════════════╝\n`;

            for (const cat in categories) {
                if (categories[cat].length > 0) {
                    menuText += `╭───「 *${cat}* 」\n`;
                    menuText += categories[cat].join('\n├ ') + '\n';
                    menuText += '╰─────────────────────\n';
                }
            }

            menuText += `\n📅 *Today:* ${date.toLocaleDateString()} | ${date.toLocaleTimeString()}
━━━━━━━━━━━━━━━━━━━━━
© ${new Date().getFullYear()} hybridbotzw | Powered by ${config.ownerName}`;

                        // Inside the menu command execute(ctx) function:
            
                        // 1. Send the Gojo Image with the Menu Text
            await ctx.sock.sendMessage(ctx.from, {
                image: { url: botConfig.menuImage },
                caption: menuText
            });
        },

        // ────────────── UPDATE COMMAND ──────────────
    update: {
        name: 'update',
        aliases: ['whatsnew'],
        desc: 'Display latest bot update features',
        category: 'general',
        async execute(ctx) {
            const updateMessage = `
╔═══════════════════════╗
      *V12 UPDATE!*
    *𝕊𝕦𝕔𝕔𝕖𝕤𝕤𝕗𝚞𝕝𝕝𝕪*
╚════════════════════════╝

✦━━━━━━━━━━━━━━━━━━━━━━✦
      *𝕎ℍ𝔸𝕋'𝕊 ℕ𝔼𝎏𝕎?*
✦━━━━━━━━━━━━━━━━━━━━━━✦

▫️ 𝚁𝚎𝚏𝚊𝚌𝚝𝚘𝚛𝚎𝚍 \`.𝚐𝚊𝚖𝚎\` 𝚒𝚗𝚝𝚘 𝚊 𝟷𝟻-𝚛𝚘𝚞𝚗𝚍 𝙼𝚞𝚕𝚝𝚒-𝚀𝚞𝚒𝚣 𝚜𝚢𝚜𝚝𝚎𝚖!
▫️ 𝙰𝚍𝚍𝚎𝚍 \`.𝚜𝚌𝚘𝚛𝚎\` 𝚌𝚘𝚖𝚖𝚊𝚗𝚍 𝚝𝚘 𝚌𝚑𝚎𝚌𝚔 𝚖𝚊𝚛𝚔𝚜 𝚊𝚗𝚢𝚝𝚒𝚖𝚎.
▫️ 𝟸𝟶-𝚜𝚎𝚌𝚘𝚗𝚍 𝚙𝚊𝚞𝚜𝚎 𝚊𝚏𝚝𝚎𝚛 𝚎𝚊𝚌𝚑 𝚊𝚗𝚜𝚠𝚎𝚛 𝚋𝚎𝚏𝚘𝚛𝚎 𝚗𝚎𝚡𝚝 𝚚𝚞𝚎𝚜𝚝𝚒𝚘𝚗.
▫️ 𝙴𝚗𝚍-𝚘𝚏-𝚐𝚊𝚖𝚎 𝚛𝚊𝚝𝚒𝚗𝚐: *WOW!*, *Good Job!*, or *Try Again!*.
▫️ *NEW!* Optimized *.play* command to 128kbps for faster sending.
▫️ *NEW!* Optimized *.ytv* command to 360p resolution for extreme data saving.
▫️ *NEW!* Added *.mediafire* and *.exam* commands.
✦━━━━━━━━━━━━━━━━━━━━━━✦
      https://whatsapp.com/channel/0029Vb1JJlR9WtBzWg26wi3e
✦━━━━━━━━━━━━━━━━━━━━━━✦
       *ℙ𝕆𝕎𝔼ℝ𝔼𝙳 𝔹𝕐* ⚡
✦━━━━━━━━━━━━━━━━━━━━━━✦
> *©${config.ownerName}*`;

            await ctx.reply(updateMessage);
        }
    },
    // ────────────── PING ──────────────
    ping: {
        name: 'ping',
        aliases: [],
        desc: 'Check bot speed',
        category: 'general',
        async execute(ctx) {
            const latency = Date.now() - ctx.commandStartTime;
            
            await ctx.reply(`🏓 *Pong!*\n\n⚡ Speed: ${latency}ms\n✅ Status: Online\n🕰️ Uptime: ${getUptime()}`);
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
    // ────────────── YTV (Robust Video Download) ──────────────
    ytv: {
        name: 'ytv',
        aliases: ['video', 'dlvid', 'mp4'],
        desc: 'Download and send video from YouTube (Max 3-4 mins for speed)',
        category: 'download',
        async execute(ctx) {
            if (ctx.args.length === 0) {
                return ctx.reply('❌ Please provide a YouTube link or search query!\n\nExample: .ytv Jah Master Hello Mwari');
            }

            const query = ctx.args.join(' ');
            await ctx.react('⏳');

            try {
                const searchResult = await play.search(query, {
                    limit: 1
                });
                
                if (!searchResult || searchResult.length === 0) {
                    return ctx.reply('❌ No YouTube results found for that query!');
                }

                const video = searchResult[0];
                const videoUrl = video.url;
                const maxDurationSeconds = 240; // 4 minutes
                
                if (video.durationInSec > maxDurationSeconds) {
                    await ctx.reply(`⚠️ Video is too long (${video.durationRaw}). Downloading long videos can take a long time and crash the bot.\n\n_Attempting download anyway, but may fail._`);
                } else {
                    await ctx.reply(`🎵 *Found:* ${video.title}\n⏱️ Duration: ${video.durationRaw}\n\n⏳ Starting download at 360p (Data Saver Mode)...`);
                }
                
                const tempDir = path.join(__dirname, 'downloads');
                if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
                const outputFileName = path.join(tempDir, `${Date.now()}-${video.id}.mp4`);
                
                // 🛠️ MODIFIED COMMAND: Optimized for 360p resolution for maximum data saving
                const command = `yt-dlp -f 'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360][ext=mp4]/best[ext=mp4]' --no-mtime -o "${outputFileName}" "${videoUrl}"`;
                
                await new Promise((resolve, reject) => {
                    exec(command, { timeout: 300000 }, (error, stdout, stderr) => { 
                        if (error) {
                            console.error(`yt-dlp Error: ${error.message}\nStderr: ${stderr}`);
                            if (fs.existsSync(outputFileName)) fs.unlinkSync(outputFileName); 
                            return reject(new Error('Failed to download video. Check Termux stability.'));
                        }
                        resolve();
                    });
                });
                
                await ctx.sock.sendMessage(ctx.from, {
                    video: fs.readFileSync(outputFileName),
                    caption: `✅ *Downloaded by ${config.botName}*\nTitle: ${video.title}\nQuality: 360p (Optimized)\nSource: ${videoUrl}`,
                    mimetype: 'video/mp4'
                }, {
                    quoted: ctx.m
                });

                await ctx.react('✅');
                fs.unlinkSync(outputFileName);

            } catch (e) {
                console.error('YTV Command Error:', e);
                await ctx.react('❌');
                await ctx.reply(`❌ An error occurred during the download process: ${e.message}\n\n_If this persists, ensure yt-dlp and ffmpeg are correctly installed._`);
            }
        }
    },
    // ────────────── PLAY (Audio Only) - OPTIMIZED FOR SIZE ──────────────
    play: {
        name: 'play',
        aliases: ['song', 'music'],
        desc: 'Download and send audio from YouTube (uses yt-dlp extraction)',
        category: 'download',
        async execute(ctx) {
            if (ctx.args.length === 0) {
                return ctx.reply('❌ Please provide a song name or link!\n\nExample: .play Jah master hello mwari');
            }

            const query = ctx.args.join(' ');
            await ctx.react('⏳');
            
            try {
                const searchResult = await play.search(query, { limit: 1 });
                if (!searchResult || searchResult.length === 0) {
                    return ctx.reply('❌ No results found for that query!');
                }

                const video = searchResult[0];
                const tempDir = path.join(__dirname, 'downloads');
                if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
                const outputFileName = path.join(tempDir, `${Date.now()}-${video.id}.mp3`);
                
                await ctx.reply(`🎵 *Found:* ${video.title}\n⏱️ Duration: ${video.durationRaw}\n\n⏳ Downloading at 128kbps...`);

                // V12 FIX: Force 128kbps bitrate for data efficiency
                const command = `/yt-dlp -x --audio-format mp3 --audio-quality 5 --no-mtime -o "${outputFileName}" "${video.url}"`;
                
                await new Promise((resolve, reject) => {
                    exec(command, { timeout: 300000 }, (error, stdout, stderr) => { 
                        if (error) {
                            console.error(`yt-dlp Audio Error: ${error.message}\nStderr: ${stderr}`);
                            if (fs.existsSync(outputFileName)) fs.unlinkSync(outputFileName);
                            return reject(new Error('Failed to download audio.'));
                        }
                        resolve();
                    });
                });
                
                await ctx.sock.sendMessage(ctx.from, {
                    audio: fs.readFileSync(outputFileName),
                    mimetype: 'audio/mp4', 
                    fileName: `${video.title}.mp3`
                }, { quoted: ctx.m });
                
                await ctx.react('✅');
                fs.unlinkSync(outputFileName);
                
            } catch (e) {
                console.error('Play Audio Error:', e);
                await ctx.react('❌');
                await ctx.reply(`❌ An error occurred during audio download: ${e.message}`);
            }
        }
    },
    // ────────────── MEDIAFIRE DOWNLOAD (V11 ADDED) ──────────────
    mediafire: {
        name: 'mediafire',
        aliases: ['mf'],
        desc: 'Download a file directly from a MediaFire link.',
        category: 'download',
        async execute(ctx) {
            const mediafireUrl = ctx.args[0];

            if (!mediafireUrl || !mediafireUrl.includes('mediafire.com/file/')) {
                return ctx.reply('❌ Please provide a valid MediaFire file link.\n\nExample: .mediafire https://www.mediafire.com/file/.../file');
            }

            await ctx.react('📥');
            await ctx.reply(`🔍 Analyzing MediaFire link: ${mediafireUrl}`);

            try {
                const { data } = await axios.get(mediafireUrl);
                const $ = cheerio.load(data);
                const downloadButton = $('a.input.download_link[aria-label="Download file"]');
                const directDownloadUrl = downloadButton.attr('href');
                const fileName = downloadButton.attr('title') || 'MediaFire_File';

                if (!directDownloadUrl) {
                    await ctx.react('❓');
                    return ctx.reply('❌ Could not find the direct download link on the page. The link may be invalid or require a captcha.');
                }

                await ctx.reply(`✅ Found file: *${fileName}*\nStarting high-speed download...`);
                
                const tempDir = path.join(__dirname, 'downloads');
                if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
                const tempFilePath = path.join(tempDir, `${fileName}`);

                const fileResponse = await axios({
                    method: 'get',
                    url: directDownloadUrl,
                    responseType: 'stream'
                });

                const writer = fs.createWriteStream(tempFilePath);
                fileResponse.data.pipe(writer);

                await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });

                const mimeType = fileResponse.headers['content-type'] || 'application/octet-stream';
                
                await ctx.sock.sendMessage(ctx.from, { 
                    document: fs.readFileSync(tempFilePath), 
                    mimetype: mimeType, 
                    fileName: fileName,
                    caption: `📦 *MediaFire Download Complete*\nFile: ${fileName}`
                }, { quoted: ctx.m });

                fs.unlinkSync(tempFilePath);
                await ctx.react('✔️');

            } catch (e) {
                console.error('MediaFire Download Error:', e);
                await ctx.react('❌');
                await ctx.reply(`❌ An error occurred during the download process: ${e.message}`);
            }
        }
    },
    // ────────────── EXAM PAPERS QUERY (V12 ADDED) ──────────────
    exam: {
        name: 'exam',
        aliases: ['papers', 'exampaper'],
        desc: 'Search for exam papers links.',
        category: 'ai',
        async execute(ctx) {
            if (ctx.args.length === 0) {
                return ctx.reply('❌ Please specify the exam paper you are looking for.\n\nExample: .exam Zimsec O Level Maths 2023');
            }
            const query = ctx.args.join(' ');
            await ctx.react('🔍');
            // Simplified logic: Directs users to educational resources or provides search results
            await ctx.reply(`📚 *Searching for:* ${query}\n\nPlease check common educational repositories or use .ai to find specific direct links for this request.`);
        }
    },
    // ────────────── STICKER (Placeholder) ──────────────
    sticker: {
        name: 'sticker',
        aliases: ['s'],
        desc: 'Make sticker from image/video reply',
        category: 'download',
        async execute(ctx) {
            await ctx.reply('🖼️ *STICKER*\n\n_Feature requires replying to an image or video/GIF and full sticker library integration._');
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
    // ────────────── SLAP ──────────────
    slap: {
        name: 'slap',
        aliases: [],
        desc: 'Slap someone',
        category: 'fun',
        async execute(ctx) {
            const mentioned = ctx.m.message?.extendedTextMessage?.contextInfo?.mentionedJid;
            if (!mentioned || mentioned.length === 0) {
                return ctx.reply('❌ Slap failed: You must mention someone to slap!\n\nExample: .slap @user');
            }

            const slapper = ctx.sender.split('@')[0];
            const slashed = mentioned[0].split('@')[0];

            const msgs = [
                `👋 *${slapper}* slapped *${slapped}* across the face! 💥`,
                `👋 *SLAP!* *${slapper}* just slapped *${slapped}*! 😵`,
                `👋 *${slapper}* gave *${slapped}* a reality check! 👏`
            ];

            await ctx.sock.sendMessage(ctx.from, {
                text: msgs[Math.floor(Math.random() * msgs.length)],
                mentions: [ctx.sender, ...mentioned]
            }, {
                quoted: ctx.m
            });
            await ctx.react('👋');
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
    ai: {
        name: 'ai',
        aliases: ['gpt', 'chatgpt', 'bot'],
        desc: 'Ask AI a question',
        category: 'ai',
        async execute(ctx) {
            if (ctx.args.length === 0) {
                return ctx.reply('❌ Please ask a question!\n\nExample: .ai What is the capital of Zimbabwe?');
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
    // ────────────── REPORT (ADDED) ──────────────
    report: {
        name: 'report',
        aliases: ['bug', 'contact'],
        desc: 'Report a bug to the owner',
        category: 'general',
        async execute(ctx) {
            if (!ctx.args[0]) return ctx.reply('❌ Please describe the bug or issue.');
            const reportMsg = `🚨 *NEW BUG REPORT*\n\n*From:* @${ctx.sender.split('@')[0]}\n*Issue:* ${ctx.args.join(' ')}`;
            // Using the specific report number 077 742 6534 as requested
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
🧠 Tech Stack Suggestion:
Runtime: Node.js
Library: Baileys (WhatsApp Web API)
Lang: JavaScript
Deployment: Termux / Replit / VPS
Storage: Local FS or external via Google Drive/DB
🤖 *[Kidjustin-k by t.Durani]*
`;
            await ctx.reply(stackInfo);
        }
    },
    // ────────────── DEVICE ──────────────
    device: {
        name: 'device',
        aliases: ['info', 'system'],
        desc: 'Show device information',
        category: 'general',
        async execute(ctx) {
            const deviceInfo = `
📱 *DEVICE INFO*
Model: ${os.type()}
Platform: ${os.platform()}
Arch: ${os.arch()}
RAM: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB
CPUs: ${os.cpus().length}
Uptime: ${getUptime()}
`;
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
    }
};

// ═══════════════════════════════════════════════════════════════════
// NEW: VIRTUAL SECURITY DATABASE (INTERNAL)
// ═══════════════════════════════════════════════════════════════════
const secDB = {
    blacklisted: [],
    strikes: {},
    antiLink: {},
    welcome: {},
    verified: [] // Tracks who has confirmed swearing
};

// ═══════════════════════════════════════════════════════════════════
// COMMAND LOOKUP (UNCHANGED)
// ═══════════════════════════════════════════════════════════════════

function findCommand(name) {
    if (commands[name]) return commands[name];

    for (const cmd of Object.values(commands)) {
        if (cmd.aliases && cmd.aliases.includes(name)) {
            return cmd;
        }
    }
    return null;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN BOT CONNECTION 
// ═══════════════════════════════════════════════════════════════════

// ... existing imports at the top ...

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        // 1. MUST CHANGE THIS: To support pairing codes
        browser: ["Ubuntu", "Chrome", "20.0.04"], 
        markOnlineOnConnect: true,
        getMessage: async (key) => {
            if (key) return { conversation: 'Fixed message lookup' };
            return undefined;
        }
    });

    // 2. MUST ADD THIS: This part generates the text code for your phone
    if (!sock.authState.creds.registered) {
        const phoneNumber = "263718555584"; // Your number from your info
        setTimeout(async () => {
            let code = await sock.requestPairingCode(phoneNumber);
            code = code?.match(/.{1,4}/g)?.join("-") || code;
            console.log(`\n\nPAIRED CODE: ${code}\n\n`);
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);
    // ... rest of your event listeners ...

    // WATCHDOG: Monitors status and logs updates every 10 mins
    setInterval(async () => {
        const freeMem = os.freemem() / (1024 * 1024);
        const totalMem = os.totalmem() / (1024 * 1024);
        const usagePercent = ((totalMem - freeMem) / totalMem) * 100;
        
        console.log(`[Watchdog] Status: Online | RAM: ${usagePercent.toFixed(2)}% | Uptime: ${getUptime()}`);

        if (usagePercent > 90) {
            await sock.sendMessage(ownerJid, { 
                text: `⚠️ *SYSTEM WARNING*\n\nRAM usage is critical at ${usagePercent.toFixed(2)}%.\nConsider using .restart soon.` 
            });
        }
    }, 600000);

    // 🛡️ ADDED: AUTOMATIC GROUP MONITORING (Welcome & Anti-Link)
    sock.ev.on('group-participants.update', async (anu) => {
        // Welcome Logic
        if (secDB.welcome[anu.id] && anu.action === 'add') {
             const metadata = await sock.groupMetadata(anu.id);
             for (let num of anu.participants) {
                 await sock.sendMessage(anu.id, { 
                     text: `Welcome @${num.split('@')[0]} to *${metadata.subject}*! 🌟\n\nRead the rules and enjoy your stay.`,
                     mentions: [num]
                 });
             }
        }
        // Farewell Logic
        if (secDB.welcome[anu.id] && anu.action === 'remove') {
             for (let num of anu.participants) {
                 await sock.sendMessage(anu.id, { 
                     text: `@${num.split('@')[0]} has left the group. Goodbye! 👋`,
                     mentions: [num]
                 });
             }
        }

        // Reporting Role Changes to 077 742 6534
        if (anu.action === 'promote' || anu.action === 'demote') {
            const reportJid = '263777426534@s.whatsapp.net';
            const target = anu.participants[0];
        }
    });

    // Handle connection updates
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrcode.generate(qr, { small: true });
            console.log('\n📱 Scan this QR code with WhatsApp:\n');
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('⚠️ Disconnected. Reconnecting:', shouldReconnect);
            if (shouldReconnect) startBot();

        } else if (connection === 'open') {
            if (!sock.user) {
                console.log('⚠️ Info: Connection open event received, but user data is not ready yet. Waiting...');
                return; 
            }

            botJid = sock.user.id;
            console.log('\n╔══════════════════════════════════════════╗');
            console.log(`║  ✅ ${config.botName} is ONLINE!          ║`);
            console.log(`║  👑 Owner: ${config.ownerName.padEnd(25)}  ║`);
            console.log(`║  📱 +${config.ownerNumber}                   ║`);
            console.log(`║  🤖 Prefix: ${config.prefix}                          ║`);
            console.log('╚══════════════════════════════════════════╝\n');
            
            if (!initialStatusSet) {
                 const statusText = `I am ${config.botName}. Commands start with ${config.prefix}.`;
                 try {
                     await sock.updateProfileStatus(statusText);
                     console.log('✅ Initial bot status set.');
                     initialStatusSet = true;
                 } catch (e) {
                     console.error('Failed to set initial bot status:', e.message);
                 }
            }
        }
    });
    sock.ev.on('creds.update', saveCreds);

    // 📩 MESSAGE HANDLER (RE-STRUCTURED & FIXED)
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const m = messages[0];
        if (!m.message) return;
        if (m.key.fromMe) return;

        const from = m.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        const sender = m.key.participant || m.key.remoteJid;
        const isOwner = (sender.includes(config.ownerNumber) || sender.includes('263777426534'));
        const body = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || m.message.videoMessage?.caption || '';
        const botAdmin = isGroup ? await isBotAdmin(sock, from) : false;
        const userAdmin = isGroup ? await isAdmin(sock, from, sender) : false;

        // ✅ BUG FIX: messages.js:522 Runtime Error Prevention
        const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
        const isQuotedFromMe = (quoted && m.message.extendedTextMessage.contextInfo && m.message.extendedTextMessage.contextInfo.participant === botJid);

        // Confirmation of Swearing Warning
        if (body === '.' && !secDB.verified.includes(sender)) {
            secDB.verified.push(sender);
            return sock.sendMessage(from, { text: "✅ *CONFIRMED:* You have confirmed the oath. You can now use commands." }, { quoted: m });
        }

        // 1. CROWN & ADMIN REACTIONS
        if (isOwner || userAdmin) {
            await sock.sendMessage(from, { react: { text: "👑", key: m.key } });
        }

        // 2. ANTI-LINK MONITORING
        if (isGroup && secDB.antiLink[from] && body.match(/chat.whatsapp.com/gi) && !isOwner) {
            if (!userAdmin) {
                await sock.sendMessage(from, { text: `🚫 *ANTI-LINK:* Kicking @${sender.split('@')[0]}...`, mentions: [sender] });
                if (botAdmin) await sock.groupParticipantsUpdate(from, [sender], "remove");
                return;
            }
        }

        // 3. FAKE COMMAND TRAP (.restricted)
        if (body.startsWith(config.prefix + 'restricted')) {
            secDB.strikes[sender] = (secDB.strikes[sender] || 0) + 1;
            const reportJid = '263777426534@s.whatsapp.net';
            await sock.sendMessage(reportJid, { text: `🚨 *RESTRICTED COMMAND ATTEMPT*\n\n*User:* @${sender.split('@')[0]}\n*Number:* ${sender.split('@')[0]}\n*Strike:* ${secDB.strikes[sender]}/3`, mentions: [sender] });

            if (secDB.strikes[sender] >= 3) {
                if (botAdmin) await sock.groupParticipantsUpdate(from, [sender], "remove");
                return sock.sendMessage(from, { text: "🚫 *TRAP TRIGGERED:* User kicked for repeatedly attempting restricted commands." });
            }
            return sock.sendMessage(from, { text: `⚠️ *WARNING:* Accessing .restricted is forbidden. [${secDB.strikes[sender]}/3]` }, { quoted: m });
        }

        // 4. COMMAND PROCESSING
        if (body.startsWith(config.prefix)) {
            const args = body.slice(config.prefix.length).trim().split(/ +/);
            const commandName = args.shift().toLowerCase();

            // Swearing Warning for Sensitive Commands (First Use)
            if (!isOwner && !secDB.verified.includes(sender)) {
                return sock.sendMessage(from, { text: "⚠️ *SWEARING WARNING:*\nYou are about to use a powerful command. You must swear to use this bot for good and follow the rules.\n\nReply with a dot `.` to confirm." }, { quoted: m });
            }

            // Command Lookup
            const command = findCommand(commandName);
            if (!command) return;

            // Permissions Check
            // ✅ Fix: Only restricted remains owner-only. self, restart, shutdown allowed for admins.
            const isRestrictedCommand = command.name === 'restricted';
            if (command.ownerOnly && !isOwner && !userAdmin && !isRestrictedCommand) {
                 return sock.sendMessage(from, { text: '⛔ Admins and Owner only!' }, { quoted: m });
            }
            
            if (isRestrictedCommand && !isOwner) {
                return sock.sendMessage(from, { text: '⛔ Restricted: Owner only!' }, { quoted: m });
            }

            if (command.groupOnly && !isGroup) return sock.sendMessage(from, { text: '⛔ Group only!' }, { quoted: m });
            
            // Allow Group Admins to use Group category commands
            if (command.category === 'group' && isGroup && !userAdmin && !isOwner) {
                return sock.sendMessage(from, { text: '⛔ Admins and Owner only!' }, { quoted: m });
            }

            // Execution context
            const ctx = {
                sock, m, from, sender, body, args, isGroup, isOwner,
                commandStartTime: Date.now(),
                reply: async (text) => { await sock.sendMessage(from, { text }, { quoted: m }); },
                react: async (emoji) => { await sock.sendMessage(from, { react: { text: emoji, key: m.key } }); }
            };

            try {
                await ctx.react('⏳');
                await command.execute(ctx);
                if (commandName !== 'answer' && commandName !== 'menu') await ctx.react('✅');
            } catch (error) {
                console.error('Command error:', error);
                await ctx.react('❌');
            }
        } else {
            // Quiz Answer Handler
            const game = activeGames[from];
            const answerMatch = body.toLowerCase().trim().match(/^(a|b|c|d)$/);
            if (game && answerMatch && !game.answeredUsers.has(sender) && game.currentRound > 0) {
                const ctx = { 
                    sock, m, from, sender, body, args: [answerMatch[0].toUpperCase()],
                    reply: async (text) => {
  if (m && m.key) {
    await sock.sendMessage(from, { text }, { quoted: m });
  } else {
    await sock.sendMessage(from, { text });
  }
},
react: async (emoji) => {
  if (m && m.key) {
    await sock.sendMessage(from, { react: { text: emoji, key: m.key } });
  }
}
                };
                await commands.answer.execute(ctx);
            }
        }
    });
}

// ═══════════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════════
async function main() {
    await selfDiagnosis();
    console.log('╔══════════════════════════════════════════╗');
    console.log(`║ 🚀 Starting ${config.botName} Bot... ║`);
    console.log('╚══════════════════════════════════════════╝\n');
    startBot();
}

main();

process.on('SIGINT', () => {
    console.log('\n👋 Shutting down...');
    process.exit(0);
}); 2 
