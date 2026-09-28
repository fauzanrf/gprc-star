FROM node:20-alpine

WORKDIR /app

# git dibutuhkan oleh @whiskeysockets/baileys (beberapa dep diinstall dari GitHub)
RUN apk add --no-cache git python3 make g++

# Install dependencies
COPY package.json .
RUN npm install --production

# Copy source
COPY index.js .

# Session storage (mount sebagai volume)
RUN mkdir -p /app/session

EXPOSE 3001
CMD ["node", "index.js"]
