FROM node:22-alpine
WORKDIR /app
COPY package.json server.mjs ./
COPY src ./src
COPY public ./public
ENV NODE_ENV=production PORT=8090 DATA_DIR=/data
VOLUME /data
EXPOSE 8090
CMD ["node", "--no-warnings=ExperimentalWarning", "server.mjs"]
