FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci --workspace=server --include-workspace-root=false --omit=dev

COPY server server

ENV NODE_ENV=production

EXPOSE 3001

CMD ["npm", "run", "start", "--workspace", "server"]
