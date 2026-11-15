# Single-instance Cricket staging image. Fictional demonstration data only.
# SQLite must live on persistent LOCAL disk; never shared network storage.
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    CRICKET_DATA_DIR=/var/lib/cricket
WORKDIR /srv/cricket
COPY --chown=node:node . .
RUN mkdir -p /var/lib/cricket && chown -R node:node /var/lib/cricket
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
 CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server/server.js"]
