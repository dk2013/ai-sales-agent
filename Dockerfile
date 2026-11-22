# One image for the dashboard and the worker. Dev dependencies stay because the worker, the MCP server
# and the CLI scripts (db:migrate, db:seed, eval) run with tsx inside the same image.
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3002
CMD ["npm", "start"]
