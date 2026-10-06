FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-openpyxl python3-yaml poppler-utils tesseract-ocr tesseract-ocr-chi-sim && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN RD_LOCAL_PREVIEW=1 npm run build
RUN mkdir -p /app/storage && chown -R node:node /app
USER node

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3220

EXPOSE 3220

CMD ["npm", "run", "start", "--", "--host", "0.0.0.0", "--port", "3220"]
