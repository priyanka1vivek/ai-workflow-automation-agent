FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
ENV HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/data
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
