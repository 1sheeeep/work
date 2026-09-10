FROM maven:3.9.11-eclipse-temurin-25@sha256:407c4423cec0cf2981055bc2c6c0dc211d9605b6669279b95997f2d1c7e91e2c AS build
WORKDIR /workspace
COPY backend/pom.xml .
RUN mvn -B -q dependency:go-offline
COPY backend/src src
RUN mvn -B -q -DskipTests package

FROM eclipse-temurin:25-jre-alpine@sha256:28db6fdf60e38945e43d840c0333aeaec66c15943070104f7586fd3c9d1665b0
RUN apk add --no-cache nodejs npm \
    && npm install --global --no-audit --no-fund @shopify/cli@4.7.0 \
    && npm cache clean --force \
    && addgroup -S erp && adduser -S -G erp erp \
    && mkdir -p /var/lib/xz-erp/product-images \
    && chown -R erp:erp /var/lib/xz-erp
WORKDIR /app
COPY --from=build /workspace/target/erp-backend-*.jar app.jar
COPY --chown=erp:erp customer-service/shopify.app.toml /opt/xz-erp/shopify/shopify.app.toml
COPY --chown=erp:erp customer-service/package.json /opt/xz-erp/shopify/package.json
COPY --chown=erp:erp customer-service/package-lock.json /opt/xz-erp/shopify/package-lock.json
COPY --chown=erp:erp customer-service/extensions/xinzhi-support-chat /opt/xz-erp/shopify/extensions/xinzhi-support-chat
ENV ERP_SHOPIFY_RELEASE_CLI_PATH=shopify
ENV ERP_SHOPIFY_RELEASE_PROJECT_DIR=/opt/xz-erp/shopify
USER erp
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
