FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci --workspace=client --include-workspace-root=false

COPY client client

ENV SYNCFORGE_SERVER_URL=http://server:3001
EXPOSE 5173

CMD ["npm", "run", "dev", "--workspace", "client", "--", "--host", "0.0.0.0"]
