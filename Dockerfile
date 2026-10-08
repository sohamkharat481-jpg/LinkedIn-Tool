# Multi-stage production Dockerfile for Google Cloud Run
# Optimized for Node.js Express Backend & Static SPA serving

FROM node:20-slim AS builder

WORKDIR /app

# Copy dependency files
COPY package.json package-lock.json* ./

# Install all dependencies including build tools
RUN npm install

# Copy source files
COPY . .

# Build frontend production bundle
RUN npm run build

# Stage 2: Minimal production image
FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Copy package and install production dependencies
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy compiled frontend and server files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/src/server ./src/server
COPY --from=builder /app/src/services ./src/services
COPY --from=builder /app/src/types ./src/types
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/supabase_schema.sql ./supabase_schema.sql

EXPOSE 8080

# Cloud Run injects PORT (default 8080)
CMD ["npm", "start"]
