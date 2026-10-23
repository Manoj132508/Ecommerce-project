FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY tools/fast-glob-shim ./tools/fast-glob-shim
RUN npm ci

FROM dependencies AS build
COPY . .
ARG NEXT_PUBLIC_APP_NAME=Ecommerce
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3001
COPY package.json package-lock.json ./
COPY tools/fast-glob-shim ./tools/fast-glob-shim
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./next.config.ts
EXPOSE 3001
CMD ["npm", "start"]
