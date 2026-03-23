FROM node:20-slim

# Install system dependencies (Git is required for Baileys)
RUN apt-get update && apt-get install -y \
    git \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./

# Now npm install will work without the Git error
RUN npm install --omit=dev

COPY . .

# Ensure directories exist
RUN mkdir -p sessions downloads

EXPOSE 8000

CMD ["node", "index.js"]
