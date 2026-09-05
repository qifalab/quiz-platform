FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server ./server
COPY dist-web ./dist-web
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3202
CMD ["node", "server/index.mjs"]
