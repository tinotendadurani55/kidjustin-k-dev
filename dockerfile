# ═══════════════════════════════════════════
# MINIMA V13 — HuggingFace Spaces Dockerfile (FIXED)
# ═══════════════════════════════════════════

FROM node:20-slim

# ── System dependencies ──────────────────
# Added 'git' to fix the npm spawn error
RUN apt-get update && apt-get install -y \
    ffmpeg \
    curl \
    python3 \
    python3-pip \
    python-is-python3 \
    ca-certificates \
    git \
    && rm -rf /var/lib/apt/lists/*

# ── Install yt-dlp ───────────────────────
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# ── App directory ────────────────────────
WORKDIR /app

# ── Copy package files and install ───────
COPY package.json ./
# Updating npm ensures the latest installer logic is used
RUN npm install -g npm@latest && npm install --omit=dev

# ── Copy app source ───────────────────────
# It is usually safer to copy everything unless your folder is very messy
COPY . .

# ── Create runtime directories in /tmp ───
RUN mkdir -p /tmp/minima-session /tmp/minima-dl

# ── Expose port for HF health check ──────
EXPOSE 7860

# ── Environment variable defaults ────────
ENV PORT=7860
ENV BOT_NAME="MINIMA V13"
ENV OWNER_NAME="t.Durani"
ENV PREFIX="."
ENV MODE="public"

# ── Start the bot ─────────────────────────
# Allocate 4GB of RAM (or half of your HF Space limit) to handle massive Buffers
CMD ["node", "--max-old-space-size=4096", "index.js"]

