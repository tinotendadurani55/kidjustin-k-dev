FROM node:20-bullseye-slim

# 1. Set Workspace first
WORKDIR /app

# 2. Install system tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg python3 python3-pip curl wget \
    && pip3 install --no-cache-dir yt-dlp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 3. Copy dependencies
COPY hf-package.json package.json
RUN npm install --omit=dev

# 4. Copy main code (and lib folder ONLY if it exists)
COPY index.js ./
COPY lib* ./lib/

# 5. Setup directories and port
RUN mkdir -p session downloads
EXPOSE 7860

# 6. Ignition
CMD ["node", "index.js"]
