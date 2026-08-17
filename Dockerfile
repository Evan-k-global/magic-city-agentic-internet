FROM mcr.microsoft.com/playwright:v1.58.2-noble
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
COPY .well-known ./.well-known
COPY env ./env

EXPOSE 4411

ENV HOST=0.0.0.0
ENV PORT=4411
CMD ["node", "src/startWebWithRelayer.js"]
