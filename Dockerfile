FROM node:20-alpine AS builder

WORKDIR /app

# Copy lockfiles and config files
COPY package*.json tsconfig.base.json ./

# Copy packages required for building posecode-mcp
COPY packages/posecode-parser ./packages/posecode-parser
COPY packages/posecode-share ./packages/posecode-share
COPY packages/posecode-mcp ./packages/posecode-mcp

# Install all dependencies (including workspace dependencies)
RUN npm ci

# Build the MCP server
RUN npm run build -w packages/posecode-mcp

# Production stage
FROM node:20-alpine AS release

WORKDIR /app

# Copy the built bundles and node_modules (since SDK and Zod are external)
COPY --from=builder /app/packages/posecode-mcp/dist ./packages/posecode-mcp/dist
COPY --from=builder /app/node_modules ./node_modules

# Set environment to production
ENV NODE_ENV=production

# Run the stdio server
ENTRYPOINT ["node", "packages/posecode-mcp/dist/posecode-mcp.mjs"]
