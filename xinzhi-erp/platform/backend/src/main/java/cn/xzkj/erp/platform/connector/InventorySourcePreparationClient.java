package cn.xzkj.erp.platform.connector;

import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.*;
import cn.xzkj.erp.platform.connector.InventoryCommandPreparation.Provider;
import java.net.URI;
import java.net.http.*;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.*;

/** Explicit loopback-only rehearsal client. There is no production URL setting
 * or component registration. Uses the existing inventory DTO/wire contract. */
public final class InventorySourcePreparationClient implements InventoryCommandPreparation.InventoryWriter {
    private static final ObjectMapper JSON=new ObjectMapper().rebuild()
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES,DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT).build();
    private final JdbcTemplate db;private final URI base;private final Provider provider;private final String token;
    private final UUID tenant,shop;private final long bindingVersion;
    private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).followRedirects(HttpClient.Redirect.NEVER).build();
    public InventorySourcePreparationClient(JdbcTemplate db,URI base,Provider provider,String token,UUID tenant,UUID shop,long bindingVersion) {
        if(base==null || !"http".equals(base.getScheme()) || !"127.0.0.1".equals(base.getHost()) || base.getPort()<1024
                || base.getRawUserInfo()!=null || base.getRawQuery()!=null || base.getRawFragment()!=null || !base.getRawPath().isEmpty()
                || provider==null || token==null || !token.matches("[!-~]{32,256}") || tenant==null || shop==null || bindingVersion<1)throw blocked();
        this.db=Objects.requireNonNull(db);this.base=base;this.provider=provider;this.token=token;this.tenant=tenant;this.shop=shop;this.bindingVersion=bindingVersion;
    }
    @Override public InventorySetResult write(UUID tenantId,UUID shopId,InventorySetRequest request) {
        if(!tenant.equals(tenantId) || !shop.equals(shopId) || request==null)throw blocked();
        var routes=db.query("""
                SELECT route_version FROM integration_preparation.inventory_commands WHERE tenant_id=? AND shop_id=? AND command_id=? AND provider=? AND state='UNKNOWN'
                """,(rs,n)->rs.getLong(1),tenant,shop,request.publicationId(),provider.name());
        if(routes.size()!=1)throw blocked();
        String path=provider==Provider.CS_STORE_APP?"/internal/v1/erp-store-app/shopify/inventory-set-preparation":"/api/v1/erp-connector/shopify/inventory-set";
        Map<String,Object> payload=Map.of("identity",Map.of("tenantId",tenant,"shopId",shop),
                "context",Map.of("correlationId",request.publicationId(),"requestId",request.publicationId()),
                "inventoryItemId",request.externalInventoryItemRef(),"locationId",request.externalLocationRef(),
                "expectedAvailable",request.expectedAvailable(),"targetAvailable",request.targetAvailable(),
                "idempotencyKey",request.idempotencyKey(),"referenceDocumentUri","xz-erp://inventory-publications/"+request.publicationId());
        try {
            var call=HttpRequest.newBuilder(base.resolve(path)).timeout(Duration.ofSeconds(10))
                    .header("Content-Type","application/json").header("X-XZ-ERP-Connector-Token",token)
                    .header("X-XZ-Store-App-Binding-Version",Long.toString(bindingVersion))
                    .header("X-XZ-Inventory-Route-Version",Long.toString(routes.getFirst()))
                    .POST(HttpRequest.BodyPublishers.ofByteArray(JSON.writeValueAsBytes(payload))).build();
            var response=http.send(call,HttpResponse.BodyHandlers.ofInputStream());
            try(var body=response.body()) {
                if(response.statusCode()!=200 || !response.headers().allValues("X-XZ-Shopify-Provider").equals(List.of(provider.name()))
                        || !response.headers().allValues("X-XZ-Inventory-Route-Version").equals(List.of(Long.toString(routes.getFirst()))))throw blocked();
                byte[] raw=body.readNBytes(65537);if(raw.length>65536)throw blocked();
                WireResult r=JSON.readValue(raw,WireResult.class);
                if(!"shopify.connector.inventory_set.v1".equals(r.contractVersion()) || !tenant.toString().equals(r.tenantId()) || !shop.toString().equals(r.shopId())
                        || !request.externalInventoryItemRef().equals(r.inventoryItemId()) || !request.externalLocationRef().equals(r.locationId())
                        || request.expectedAvailable()!=r.expectedAvailable() || request.targetAvailable()!=r.targetAvailable() || r.updatedAt()==null)throw blocked();
                return new InventorySetResult(InventorySetOutcome.valueOf(r.outcome()),r.inventoryItemId(),r.locationId(),r.expectedAvailable(),r.targetAvailable(),r.safeErrorCode(),Instant.parse(r.updatedAt()));
            }
        }catch(InterruptedException interrupted){Thread.currentThread().interrupt();throw blocked();}
        catch(Exception failure){throw blocked();}
    }
    private record WireResult(String contractVersion,String tenantId,String shopId,String outcome,String inventoryItemId,String locationId,int expectedAvailable,int targetAvailable,String safeErrorCode,String updatedAt) { }
    private static InventoryCommandPreparation.Rejected blocked(){return new InventoryCommandPreparation.Rejected("INVENTORY_SOURCE_RECONCILIATION_REQUIRED");}
}
