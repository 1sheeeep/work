package cn.xzkj.erp.platform.connector;

import static org.assertj.core.api.Assertions.assertThat;
import java.net.URI;
import java.net.http.*;
import java.nio.file.*;
import java.sql.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.MountableFile;

class IdentityPreparationRestoreTest {
    @TempDir Path temporary;

    @Test void restoresBothOwnedDatabasesAndNativeRolesWithoutOverwritingNewMessages()throws Exception {
        try(var active=new IdentityPreparationBrowserTest.Owned(temporary);
            var restoredCS=new PostgreSQLContainer<>("postgres:16-alpine").withImagePullPolicy(i->false)
                    .withDatabaseName("cs_identity_rehearsal").withUsername("synthetic_cs_owner").withPassword("synthetic_cs_owner");
            var restoredERP=new PostgreSQLContainer<>("postgres:16-alpine").withImagePullPolicy(i->false)
                    .withDatabaseName("identity_browser_rehearsal").withUsername("synthetic_erp").withPassword("synthetic_erp")) {
            var cs=db(active.cs);
            cs.update("INSERT INTO customer_service.shops(id,display_name,platform,status,created_at,updated_at) VALUES('owned-shop','Synthetic shop','shopify','active',now(),now())");
            cs.update("INSERT INTO customer_service.shop_sources(id,shop_id,type,provider,status,created_at,updated_at) VALUES('owned-source','owned-shop','chat','synthetic','active',now(),now())");
            cs.update("INSERT INTO customer_service.conversations(id,shop_id,source_id,status,last_message_at,created_at,updated_at) VALUES('owned-conversation','owned-shop','owned-source','open',now(),now(),now())");
            cs.update("INSERT INTO customer_service.messages(id,conversation_id,direction,body,created_at) VALUES('before-backup','owned-conversation','inbound','Synthetic original message',now())");
            Map<String,String> originalCS=snapshot(cs,"customer_service");
            Map<String,String> originalERP=snapshot(active.db,"public");
            Map<String,String> originalPrep=snapshot(active.db,"integration_preparation");
            Path csDump=backup(active.cs,temporary.resolve("owned-cs.dump"));
            Path erpDump=backup(active.erp,temporary.resolve("owned-erp.dump"));
            // New production-shaped data belongs to the active DB, not an old backup.
            cs.update("INSERT INTO customer_service.messages(id,conversation_id,direction,body,created_at) VALUES('after-backup','owned-conversation','inbound','Synthetic later message',now())");
            active.holder.candidate.close(); // stop only the preparation path, not native CS
            var nativeRequest=HttpRequest.newBuilder(URI.create(active.go.baseUrl+"/api/v1/auth/me")).header("Authorization","Bearer synthetic-original-cs-session").build();
            assertThat(HttpClient.newHttpClient().send(nativeRequest,HttpResponse.BodyHandlers.discarding()).statusCode()).isEqualTo(200);

            restoredCS.start();restoredERP.start();
            var csCopy=db(restoredCS);
            csCopy.execute("CREATE ROLE customer_service_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD 'not-a-real-secret-customer-service-migrator'");
            csCopy.execute("CREATE ROLE customer_service_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD 'not-a-real-secret-customer-service-runtime'");
            csCopy.execute("ALTER ROLE customer_service_migrator SET search_path=customer_service,pg_catalog");
            csCopy.execute("ALTER ROLE customer_service_runtime SET search_path=customer_service,pg_catalog");
            csCopy.execute("REVOKE TEMPORARY ON DATABASE cs_identity_rehearsal FROM PUBLIC,customer_service_migrator,customer_service_runtime");
            csCopy.execute("GRANT CONNECT ON DATABASE cs_identity_rehearsal TO customer_service_migrator,customer_service_runtime");
            csCopy.execute("COMMENT ON DATABASE cs_identity_rehearsal IS 'xz-erp-owned-identity-rehearsal-v1'");
            restore(restoredCS,csDump);restore(restoredERP,erpDump);
            assertThat(snapshot(csCopy,"customer_service")).isEqualTo(originalCS);
            assertThat(snapshot(db(restoredERP),"public")).isEqualTo(originalERP);
            assertThat(snapshot(db(restoredERP),"integration_preparation")).isEqualTo(originalPrep);
            // Restart validates native migrations, role ownership, exact CRUD and no privileged routines.
            try(var go=SyntheticStoreAppProcess.startIdentityPostgres(temporary,restoredCS.getMappedPort(5432))) {
                var request=HttpRequest.newBuilder(URI.create(go.baseUrl+"/api/v1/auth/me")).header("Authorization","Bearer synthetic-original-cs-session").build();
                assertThat(HttpClient.newHttpClient().send(request,HttpResponse.BodyHandlers.discarding()).statusCode()).isEqualTo(200);
            }
            assertThat(cs.queryForObject("SELECT count(*) FROM customer_service.messages",Integer.class)).isEqualTo(2);
            assertThat(csCopy.queryForObject("SELECT count(*) FROM customer_service.messages",Integer.class)).isEqualTo(1);
            assertThat(cs.queryForObject("SELECT body FROM customer_service.messages WHERE id='after-backup'",String.class)).isEqualTo("Synthetic later message");
        }
    }

    private static JdbcTemplate db(PostgreSQLContainer<?> p){return new JdbcTemplate(new DriverManagerDataSource(p.getJdbcUrl(),p.getUsername(),p.getPassword()));}
    private static Path backup(PostgreSQLContainer<?> p,Path target)throws Exception {
        var result=p.execInContainer("pg_dump","-U",p.getUsername(),"-d",p.getDatabaseName(),"--format=custom","--file=/tmp/owned-preparation.dump");
        assertThat(result.getExitCode()).isZero();
        p.copyFileFromContainer("/tmp/owned-preparation.dump",input->{Files.copy(input,target);return null;});
        assertThat(Files.size(target)).isGreaterThan(100);return target;
    }
    private static void restore(PostgreSQLContainer<?> p,Path source)throws Exception {
        p.copyFileToContainer(MountableFile.forHostPath(source),"/tmp/owned-preparation.dump");
        var result=p.execInContainer("pg_restore","--exit-on-error","-U",p.getUsername(),"-d",p.getDatabaseName(),"/tmp/owned-preparation.dump");
        assertThat(result.getExitCode()).isZero();
    }
    private static Map<String,String> snapshot(JdbcTemplate db,String schema) {
        if(!Set.of("customer_service","public","integration_preparation").contains(schema))throw new IllegalArgumentException();
        var result=new TreeMap<String,String>();
        for(String table:db.queryForList("SELECT tablename FROM pg_tables WHERE schemaname=? ORDER BY tablename",String.class,schema)) {
            if(!table.matches("[a-z0-9_]+"))throw new IllegalArgumentException();
            result.put(table,db.queryForObject("SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) FROM "+schema+"."+table+" t",String.class));
        }
        return result; // test assertion shows only fixed table names + digests, never row data
    }
}
