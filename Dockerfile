FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
FROM node:24-alpine AS runtime
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && mkdir -p media deployments && chown -R node:node media deployments
COPY --from=build /app/dist ./dist
COPY public ./public
COPY docs ./docs
USER node
EXPOSE 3000
CMD ["node","dist/main.js"]
FROM build AS tools
COPY db ./db
COPY docs ./docs
COPY public ./public
COPY contracts ./contracts
COPY scripts ./scripts
COPY test ./test
COPY examples ./examples
RUN mkdir -p deployments evidence
