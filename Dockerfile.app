FROM node:22-bookworm-slim
WORKDIR /app
COPY runtime/ /app/
COPY web/ /app/web/
RUN mkdir /data && chown node:node /data
USER node
ENV HOST=0.0.0.0 PORT=3114 PROJECT_DIR=/app/web DATA_DIR=/data
EXPOSE 3114
CMD ["node", "proof-server.mjs"]
