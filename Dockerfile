FROM node:18-alpine

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy only the server source files
COPY server.js db.js ./

EXPOSE 3000

CMD ["node", "server.js"]
