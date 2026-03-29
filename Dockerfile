FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    ffmpeg \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install production dependencies
RUN npm install --production

# Copy the rest of the files
COPY . .

# Create directories and set permissions
RUN mkdir -p session downloads && chmod 777 session downloads

# Set Environment
ENV NODE_ENV=production
# Match your code's default port
ENV PORT=3000

# Inform Docker which port the container listens on
EXPOSE 3000

# Optional: Healthcheck using the http server you wrote
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3000), (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

CMD ["node", "index.js"]
