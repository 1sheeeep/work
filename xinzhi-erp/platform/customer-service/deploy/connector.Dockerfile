FROM golang:1.25-bookworm AS build

ARG GOPROXY=https://proxy.golang.org,direct
WORKDIR /src
COPY go.mod go.sum ./
RUN GOPROXY="$GOPROXY" go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/shopify-connector ./cmd/shopify-connector

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates wget \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 65532 --home-dir /nonexistent --shell /usr/sbin/nologin connector \
    && mkdir -p /var/lib/xz-erp-connector \
    && chown connector:connector /var/lib/xz-erp-connector
COPY --from=build /out/shopify-connector /shopify-connector
USER connector
EXPOSE 8790
ENTRYPOINT ["/shopify-connector"]
CMD ["-addr", "0.0.0.0:8790"]
