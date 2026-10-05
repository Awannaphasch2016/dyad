FROM node:22-alpine

RUN apk add --no-cache git github-cli

WORKDIR /opt/wewebplus-preview

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY bin.js ./bin.js
COPY src ./src

RUN chmod 755 /opt/wewebplus-preview/bin.js \
  && ln -s /opt/wewebplus-preview/bin.js /usr/local/bin/wewebplus-preview

ENTRYPOINT ["wewebplus-preview"]
