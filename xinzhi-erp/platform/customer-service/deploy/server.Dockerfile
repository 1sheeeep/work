FROM golang:1.25-bookworm AS build

ARG GOPROXY=https://proxy.golang.org,direct
WORKDIR /src
COPY go.mod go.sum ./
RUN GOPROXY="$GOPROXY" go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/support-server ./cmd/support-server \
    && mkdir -p /out/uploads \
    && chown 65532:65532 /out/uploads

FROM node:22-alpine
RUN apk add --no-cache ca-certificates \
    && npm install --global @shopify/cli@4.4.0 \
    && npm cache clean --force
ARG XZDESK_RELEASE_ID=development
LABEL org.opencontainers.image.title="Xzdesk API" \
      org.opencontainers.image.revision="${XZDESK_RELEASE_ID}"
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
ENV SHOPIFY_CLI_PATH=shopify
ENV SHOPIFY_EXTENSION_TEMPLATE_DIR=/opt/xzdesk/extensions/xinzhi-support-chat
ENV XZDESK_RELEASE_ID=${XZDESK_RELEASE_ID}
COPY --from=build /out/support-server /support-server
COPY --from=build --chown=node:node /out/uploads /var/lib/xzdesk/uploads
COPY --from=build --chown=node:node /src/extensions/xinzhi-support-chat /opt/xzdesk/extensions/xinzhi-support-chat
USER node
EXPOSE 8787
ENTRYPOINT ["/support-server"]
CMD ["-addr", "0.0.0.0:8787"]
