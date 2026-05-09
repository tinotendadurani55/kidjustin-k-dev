# ═══════════════════════════════════════════
# MINIMA V13 — Koyeb Dockerfile
# ═══════════════════════════════════════════

FROM node:20-slim

# ── System dependencies ──────────────────
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
RUN npm install -g npm@latest && npm install --omit=dev

# ── Copy app source ───────────────────────
COPY . .

# ── Create runtime directories ───────────
RUN mkdir -p /tmp/minima-session /tmp/minima-dl downloads

# ── Expose port for Koyeb health check ───
EXPOSE 8000

# ── Environment variable defaults ────────
ENV PORT=8000
ENV BOT_NAME="MINIMA V13"
ENV OWNER_NAME="t.Durani"
ENV PREFIX="."
ENV MODE="public"

# ── Start the bot ─────────────────────────
CMD ["node", "--max-old-space-size=4096", "index.js"]
