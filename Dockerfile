FROM node:20-alpine

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json .
RUN npm install --omit=dev

COPY src/ ./src/

# Data directory for SQLite
RUN mkdir -p /app/data

EXPOSE 3001

CMD ["node", "src/index.js"]
