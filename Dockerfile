FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src
COPY scripts ./scripts
COPY migrations ./migrations

ENV NODE_ENV=production

CMD ["node", "src/index.js"]
