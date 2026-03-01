FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 47821
CMD ["npx", "tsx", "src/index.ts"]
