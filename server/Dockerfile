FROM node:24-alpine
WORKDIR /app
COPY server.js ./
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
EXPOSE 8787
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
