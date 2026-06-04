FROM node:22-alpine

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/control-api/package.json apps/control-api/package.json
COPY apps/export-worker/package.json apps/export-worker/package.json
COPY apps/gateway/package.json apps/gateway/package.json
COPY apps/web-admin/package.json apps/web-admin/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/export-jobs/package.json packages/export-jobs/package.json

RUN npm ci

COPY . .

RUN npm run build:web-admin \
  && npm run build:control-api \
  && npm run build:export-worker \
  && npm run build:gateway

ENV NODE_ENV=production

CMD ["npm", "run", "start:control-api"]
