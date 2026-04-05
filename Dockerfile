FROM node:20-bullseye-slim

# Install system tools: ffmpeg for media processing, python3 + pip for yt-dlp
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    wget \
    && pip3 install --no-cache-dir yt-dlp \
    && ln -sf /usr/local/bin/yt-dlp /usr/local/bin/yt-dlp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy bot package.json (hf-package.json → package.json inside container)
COPY hf-package.json package.json

# Install Node dependencies (production only)
RUN npm install --omit=dev

# Copy bot source code
COPY index.js ./

# Copy optional lib folder (mongoAuth.js etc.) if it exists
COPY lib/ ./lib/

# Pre-create required runtime directories
RUN mkdir -p session downloads

# Hugging Face Spaces uses PORT env var (defaults to 7860)
EXPOSE 7860

# Start the bot
CMD ["node", "index.js"]
