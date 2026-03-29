FROM node:20-slim

# Install system dependencies
# We add python3 and build-essential in case any npm packages need compiling
RUN apt-get update && apt-get install -y \
    git \
    ffmpeg \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only package files first to leverage Docker cache
COPY package.json package-lock.json* ./

# Install dependencies (ignoring devDependencies for a smaller image)
RUN npm install --production

# Copy the rest of your bot's files
COPY . .

# Ensure necessary directories exist for local storage
RUN mkdir -p session downloads

# Set Environment to production
ENV NODE_ENV=production

EXPOSE 8000

CMD ["node", "index.js"]
