FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS build
WORKDIR /workspace
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm exec tsc && npm exec vite build

FROM nginx:1.28-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236
RUN test "$(grep -Ec '^[[:space:]]*pid[[:space:]]+/run/nginx\.pid;' /etc/nginx/nginx.conf)" -eq 1 \
    && sed -Ei 's!^[[:space:]]*pid[[:space:]]+/run/nginx\.pid;!pid /tmp/nginx.pid;!' /etc/nginx/nginx.conf \
    && grep -Fx 'pid /tmp/nginx.pid;' /etc/nginx/nginx.conf
COPY deploy/erp-uat/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/erp-uat/proxy_params /etc/nginx/proxy_params
COPY --from=build /workspace/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
