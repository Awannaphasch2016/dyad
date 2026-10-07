FROM node:22-bookworm-slim

WORKDIR /app
COPY supervisor.mjs /app/supervisor.mjs

ENV WEAVER_BASE_URL=http://dyad:32100

USER node
CMD ["node", "/app/supervisor.mjs"]
