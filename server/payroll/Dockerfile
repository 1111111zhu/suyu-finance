FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY database/payroll ./database/payroll
COPY server/payroll ./server/payroll
USER node
ENV NODE_ENV=production PAYROLL_API_HOST=0.0.0.0 PAYROLL_API_PORT=3002
EXPOSE 3002
CMD ["node", "server/payroll/start.mjs"]
