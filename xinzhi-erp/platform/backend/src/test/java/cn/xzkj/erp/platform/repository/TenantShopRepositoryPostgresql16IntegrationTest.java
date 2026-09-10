package cn.xzkj.erp.platform.repository;

import static org.assertj.core.api.Assertions.assertThat;

import cn.xzkj.erp.ErpApplication;
import cn.xzkj.erp.platform.domain.AuthorizationStatus;
import cn.xzkj.erp.platform.domain.PlatformCatalogEntry;
import cn.xzkj.erp.platform.domain.ShopSyncJob;
import cn.xzkj.erp.platform.domain.ShopStatus;
import cn.xzkj.erp.platform.domain.SyncJobStatus;
import cn.xzkj.erp.platform.domain.SyncJobType;
import cn.xzkj.erp.platform.domain.TenantShop;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ShopCenterActor;
import cn.xzkj.erp.platform.service.ShopCenterService;
import cn.xzkj.erp.platform.service.ShopCenterService.ShopWithAuthorization;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;

class TenantShopRepositoryPostgresql16IntegrationTest {

    private static final UUID TENANT_A = UUID.fromString(
            "94000000-0000-0000-0000-000000000001");
    private static final UUID TENANT_B = UUID.fromString(
            "94000000-0000-0000-0000-000000000002");
    private static final UUID PLATFORM_A = UUID.fromString(
            "94000000-0000-0000-0000-000000000010");
    private static final UUID PLATFORM_B = UUID.fromString(
            "94000000-0000-0000-0000-000000000011");
    private static final UUID ALPHA_SHOP = UUID.fromString(
            "94000000-0000-0000-0000-000000000101");
    private static final UUID BETA_SHOP = UUID.fromString(
            "94000000-0000-0000-0000-000000000102");
    private static final UUID DELTA_SHOP = UUID.fromString(
            "94000000-0000-0000-0000-000000000103");
    private static final UUID GAMMA_ARCHIVED_SHOP = UUID.fromString(
            "94000000-0000-0000-0000-000000000104");
    private static final UUID OMEGA_SHOP = UUID.fromString(
            "94000000-0000-0000-0000-000000000105");
    private static final UUID FIRST_DUPLICATE_SHOP = UUID.fromString(
            "94000000-0000-0000-0000-000000000106");
    private static final UUID SECOND_DUPLICATE_SHOP = UUID.fromString(
            "94000000-0000-0000-0000-000000000107");
    private static final UUID FOREIGN_SHOP = UUID.fromString(
            "94000000-0000-0000-0000-000000000201");
    private static final UUID PERCENT_LITERAL_SHOP = UUID.fromString(
            "94000000-0000-0000-0000-000000000202");
    private static final UUID PERCENT_WILDCARD_SHOP = UUID.fromString(
            "94000000-0000-0000-0000-000000000203");
    private static final UUID UNDERSCORE_LITERAL_SHOP = UUID.fromString(
            "94000000-0000-0000-0000-000000000204");
    private static final UUID UNDERSCORE_WILDCARD_SHOP = UUID.fromString(
            "94000000-0000-0000-0000-000000000205");
    private static final UUID BACKSLASH_LITERAL_SHOP = UUID.fromString(
            "94000000-0000-0000-0000-000000000206");

    private static PostgreSQLContainer<?> postgres;
    private static ConfigurableApplicationContext context;
    private static TenantShopRepository repository;
    private static ShopCenterService service;
    private static JdbcTemplate jdbcTemplate;
    private static TransactionTemplate transactionTemplate;
    private static String jdbcUrl;
    private static String username;
    private static String password;

    @BeforeAll
    static void startPostgresql16AndHibernate() throws Exception {
        postgres = new PostgreSQLContainer<>("postgres:16-alpine")
                .withDatabaseName("tenant_shop_filter_test")
                .withUsername("erp_test")
                .withPassword("erp_test");
        postgres.start();
        jdbcUrl = postgres.getJdbcUrl();
        username = postgres.getUsername();
        password = postgres.getPassword();

        Flyway.configure()
                .dataSource(jdbcUrl, username, password)
                .locations("classpath:db/migration")
                .cleanDisabled(false)
                .load()
                .migrate();

        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().addFirst(new MapPropertySource(
                "tenant-shop-filter-postgresql16-test",
                Map.ofEntries(
                        Map.entry("server.port", "0"),
                        Map.entry("spring.datasource.url", jdbcUrl),
                        Map.entry("spring.datasource.username", username),
                        Map.entry("spring.datasource.password", password),
                        Map.entry("spring.flyway.enabled", "false"),
                        Map.entry("spring.jpa.hibernate.ddl-auto", "validate"),
                        Map.entry("erp.environment", "integration-test"))));
        context = new SpringApplicationBuilder(ErpApplication.class)
                .web(WebApplicationType.SERVLET)
                .environment(environment)
                .logStartupInfo(false)
                .run();
        repository = context.getBean(TenantShopRepository.class);
        service = context.getBean(ShopCenterService.class);
        jdbcTemplate = context.getBean(JdbcTemplate.class);
        transactionTemplate = new TransactionTemplate(
                context.getBean(PlatformTransactionManager.class));
        seedFixtures();
    }

    @AfterAll
    static void stopPostgresql16() {
        if (context != null) {
            context.close();
        }
        if (postgres != null) {
            postgres.stop();
        }
    }

    @Test
    void executesTheFilteredQueryAgainstPostgresql16ThroughHibernate()
            throws Exception {
        assertThat(postgres.isRunning()).isTrue();
        assertThat(postgres.getDockerImageName()).isEqualTo("postgres:16-alpine");
        assertThat(singleString("SHOW server_version")).startsWith("16.");

        Page<TenantShop> unfiltered = list(
                TENANT_A, false, null, null, null, null, 0, 10);
        assertThat(unfiltered.getTotalElements()).isEqualTo(6);
        assertThat(names(unfiltered)).containsExactly(
                "Alpha Needle", "Beta Market", "Delta Market", "Duplicate Shop",
                "Duplicate Shop", "Omega Platform B");

        Page<TenantShop> includingArchived = list(
                TENANT_A, true, null, null, null, null, 0, 10);
        assertThat(includingArchived.getTotalElements()).isEqualTo(7);
        assertThat(names(includingArchived)).containsExactly(
                "Alpha Needle", "Beta Market", "Delta Market", "Duplicate Shop",
                "Duplicate Shop", "Gamma Archived", "Omega Platform B");
    }

    @Test
    void appliesQueryPlatformShopAndAuthorizationFiltersAsOneTenantScopedQuery() {
        Page<TenantShop> queryOnly = list(
                TENANT_A, false, "alpha-ref", null, null, null, 0, 10);
        assertThat(queryOnly.getTotalElements()).isOne();
        assertThat(names(queryOnly)).containsExactly("Alpha Needle");

        Page<TenantShop> platformOnly = list(
                TENANT_A, false, null, PLATFORM_B, null, null, 0, 10);
        assertThat(platformOnly.getTotalElements()).isOne();
        assertThat(names(platformOnly)).containsExactly("Omega Platform B");

        Page<TenantShop> statusOnly = list(
                TENANT_A, false, null, null, ShopStatus.SUSPENDED, null, 0, 10);
        assertThat(statusOnly.getTotalElements()).isOne();
        assertThat(names(statusOnly)).containsExactly("Beta Market");

        Page<TenantShop> authorizationOnly = list(
                TENANT_A, false, null, null, null, AuthorizationStatus.PENDING, 0, 10);
        assertThat(authorizationOnly.getTotalElements()).isOne();
        assertThat(names(authorizationOnly)).containsExactly("Beta Market");

        Page<TenantShop> combined = list(
                TENANT_A,
                false,
                "nEeDlE",
                PLATFORM_A,
                ShopStatus.ACTIVE,
                AuthorizationStatus.AUTHORIZED,
                0,
                10);

        assertThat(combined.getTotalElements()).isOne();
        assertThat(names(combined)).containsExactly("Alpha Needle");

        Page<TenantShop> externalReferenceMatch = list(
                TENANT_A,
                false,
                "NEEDLE-REF",
                null,
                null,
                AuthorizationStatus.PENDING,
                0,
                10);
        assertThat(externalReferenceMatch.getTotalElements()).isOne();
        assertThat(names(externalReferenceMatch)).containsExactly("Beta Market");

        Page<TenantShop> archivedAuthorized = list(
                TENANT_A,
                true,
                null,
                PLATFORM_A,
                ShopStatus.ARCHIVED,
                AuthorizationStatus.AUTHORIZED,
                0,
                10);
        assertThat(archivedAuthorized.getTotalElements()).isOne();
        assertThat(names(archivedAuthorized)).containsExactly("Gamma Archived");
    }

    @Test
    void treatsLikeMetacharactersInQueriesAsLiteralText() {
        Page<TenantShop> percent = list(
                TENANT_B, false, "100%", null, null, null, 0, 10);
        assertThat(names(percent)).containsExactly("Percent 100% Literal");

        Page<TenantShop> underscore = list(
                TENANT_B, false, "score_a", null, null, null, 0, 10);
        assertThat(names(underscore)).containsExactly("Underscore score_a Literal");

        Page<TenantShop> backslash = list(
                TENANT_B, false, "C:\\shop", null, null, null, 0, 10);
        assertThat(names(backslash)).containsExactly("Path C:\\shop Literal");
    }

    @Test
    void keepsDuplicateNamesDeterministicAcrossFilteredAndUnfilteredPages() {
        Page<TenantShop> filteredFirstDuplicatePage = list(
                TENANT_A, true, null, null, null, null, 1, 2);
        Page<TenantShop> filteredSecondDuplicatePage = list(
                TENANT_A, true, null, null, null, null, 2, 2);
        assertThat(filteredFirstDuplicatePage.getTotalElements()).isEqualTo(7);
        assertThat(ids(filteredFirstDuplicatePage)).containsExactly(
                DELTA_SHOP, FIRST_DUPLICATE_SHOP);
        assertThat(filteredSecondDuplicatePage.getTotalElements()).isEqualTo(7);
        assertThat(ids(filteredSecondDuplicatePage)).containsExactly(
                SECOND_DUPLICATE_SHOP, GAMMA_ARCHIVED_SHOP);

        Page<TenantShop> includingArchivedFirstDuplicatePage = repository
                .findAllByTenantIdOrderByDisplayNameAscIdAsc(
                        TENANT_A, PageRequest.of(1, 2));
        Page<TenantShop> includingArchivedSecondDuplicatePage = repository
                .findAllByTenantIdOrderByDisplayNameAscIdAsc(
                        TENANT_A, PageRequest.of(2, 2));
        assertThat(includingArchivedFirstDuplicatePage.getTotalElements()).isEqualTo(7);
        assertThat(ids(includingArchivedFirstDuplicatePage)).containsExactly(
                DELTA_SHOP, FIRST_DUPLICATE_SHOP);
        assertThat(includingArchivedSecondDuplicatePage.getTotalElements()).isEqualTo(7);
        assertThat(ids(includingArchivedSecondDuplicatePage)).containsExactly(
                SECOND_DUPLICATE_SHOP, GAMMA_ARCHIVED_SHOP);

        Page<TenantShop> visibleFirstDuplicatePage = repository
                .findAllByTenantIdAndStatusNotOrderByDisplayNameAscIdAsc(
                        TENANT_A, ShopStatus.ARCHIVED, PageRequest.of(1, 2));
        Page<TenantShop> visibleSecondDuplicatePage = repository
                .findAllByTenantIdAndStatusNotOrderByDisplayNameAscIdAsc(
                        TENANT_A, ShopStatus.ARCHIVED, PageRequest.of(2, 2));
        assertThat(visibleFirstDuplicatePage.getTotalElements()).isEqualTo(6);
        assertThat(ids(visibleFirstDuplicatePage)).containsExactly(
                DELTA_SHOP, FIRST_DUPLICATE_SHOP);
        assertThat(visibleSecondDuplicatePage.getTotalElements()).isEqualTo(6);
        assertThat(ids(visibleSecondDuplicatePage)).containsExactly(
                SECOND_DUPLICATE_SHOP, OMEGA_SHOP);
    }

    @Test
    void neverExposesAnotherTenantsShops() {

        Page<TenantShop> foreignQuery = list(
                TENANT_A,
                true,
                "foreign-private",
                PLATFORM_A,
                ShopStatus.ACTIVE,
                AuthorizationStatus.AUTHORIZED,
                0,
                10);
        assertThat(foreignQuery).isEmpty();

        Page<TenantShop> tenantBView = list(
                TENANT_B,
                false,
                "foreign-private",
                PLATFORM_A,
                ShopStatus.ACTIVE,
                AuthorizationStatus.AUTHORIZED,
                0,
                10);
        assertThat(tenantBView.getTotalElements()).isOne();
        assertThat(names(tenantBView)).containsExactly("Foreign Private Shop");
    }

    @Test
    void platformArchiveCommittedFirstMakesConcurrentShopCreateReject() throws Exception {
        RaceFixture fixture = createRaceFixture(false);

        RaceResult<PlatformCatalogEntry, ShopWithAuthorization> result =
                runSerializedRace(
                        () -> service.archivePlatform(
                                fixture.actor(), fixture.platformId()),
                        () -> service.createShopWithDisplayName(
                                fixture.actor(),
                                fixture.platformId(),
                                "late-shop",
                                "Late Shop")
                );

        assertThat(result.winner().getStatus().name()).isEqualTo("ARCHIVED");
        assertThat(result.loser().failure()).isInstanceOf(ConflictException.class);
        assertThat(stringValue(
                "SELECT status FROM platform_catalog WHERE id = ?",
                fixture.platformId())).isEqualTo("ARCHIVED");
        assertThat(longValue(
                "SELECT count(*) FROM tenant_shops WHERE platform_id = ?",
                fixture.platformId())).isZero();
    }

    @Test
    void shopCreateCommittedFirstMakesConcurrentPlatformArchiveReject() throws Exception {
        RaceFixture fixture = createRaceFixture(false);

        RaceResult<ShopWithAuthorization, PlatformCatalogEntry> result =
                runSerializedRace(
                        () -> service.createShopWithDisplayName(
                                fixture.actor(),
                                fixture.platformId(),
                                "first-shop",
                                "First Shop"),
                        () -> service.archivePlatform(
                                fixture.actor(), fixture.platformId())
                );

        assertThat(result.winner().shop().getStatus()).isEqualTo(ShopStatus.ACTIVE);
        assertThat(result.loser().failure()).isInstanceOf(ConflictException.class);
        assertThat(stringValue(
                "SELECT status FROM platform_catalog WHERE id = ?",
                fixture.platformId())).isEqualTo("ACTIVE");
        assertThat(longValue(
                "SELECT count(*) FROM tenant_shops WHERE platform_id = ? AND status <> 'ARCHIVED'",
                fixture.platformId())).isOne();
    }

    @Test
    void shopArchiveCommittedFirstMakesConcurrentSyncCreateReject() throws Exception {
        RaceFixture fixture = createRaceFixture(true);

        RaceResult<ShopWithAuthorization, ShopSyncJob> result =
                runSerializedRace(
                        () -> service.archiveShop(
                                fixture.actor(), fixture.shopId()),
                        () -> service.createSyncJob(
                                fixture.actor(),
                                fixture.shopId(),
                                SyncJobType.ORDERS)
                );

        assertThat(result.winner().shop().getStatus()).isEqualTo(ShopStatus.ARCHIVED);
        assertThat(result.loser().failure()).isInstanceOf(ConflictException.class);
        assertThat(stringValue(
                "SELECT status FROM tenant_shops WHERE id = ? AND tenant_id = ?",
                fixture.shopId(), fixture.tenantId())).isEqualTo("ARCHIVED");
        assertThat(longValue("""
                SELECT count(*)
                  FROM shop_sync_jobs
                 WHERE shop_id = ?
                   AND tenant_id = ?
                   AND status IN ('QUEUED', 'RUNNING')
                """, fixture.shopId(), fixture.tenantId())).isZero();
    }

    @Test
    void authorizedShopCannotBeArchivedAfterConcurrentSyncCreation() throws Exception {
        RaceFixture fixture = createRaceFixture(true);
        service.updateAuthorization(
                fixture.actor(),
                fixture.shopId(),
                AuthorizationStatus.AUTHORIZED,
                "credential://shop-lock-test/token",
                "lock-provider",
                java.util.Set.of("orders.read"),
                java.time.Instant.parse("2026-07-30T00:00:00Z"),
                null,
                null,
                null
        );

        RaceResult<ShopSyncJob, ShopWithAuthorization> result =
                runSerializedRace(
                        () -> service.createSyncJob(
                                fixture.actor(),
                                fixture.shopId(),
                                SyncJobType.ORDERS),
                        () -> service.archiveShop(
                                fixture.actor(), fixture.shopId())
                );

        assertThat(result.winner().getStatus()).isEqualTo(SyncJobStatus.QUEUED);
        assertThat(result.loser().failure()).isInstanceOf(ConflictException.class);
        assertThat(stringValue(
                "SELECT status FROM shop_sync_jobs WHERE id = ?",
                result.winner().getId())).isEqualTo("QUEUED");
        assertThat(stringValue("""
                SELECT status
                  FROM shop_authorizations
                 WHERE tenant_id = ? AND shop_id = ?
                """, fixture.tenantId(), fixture.shopId())).isEqualTo("AUTHORIZED");
        assertThat(stringValue("""
                SELECT credential_reference
                  FROM shop_authorizations
                 WHERE tenant_id = ? AND shop_id = ?
                """, fixture.tenantId(), fixture.shopId()))
                .isEqualTo("credential://shop-lock-test/token");
    }

    private static Page<TenantShop> list(
            UUID tenantId,
            boolean includeArchived,
            String query,
            UUID platformId,
            ShopStatus shopStatus,
            AuthorizationStatus authorizationStatus,
            int page,
            int size) {
        return repository.findAllForTenantShopList(
                tenantId,
                includeArchived,
                ShopStatus.ARCHIVED,
                query,
                platformId,
                shopStatus,
                authorizationStatus,
                PageRequest.of(page, size));
    }

    private static List<String> names(Page<TenantShop> page) {
        return page.getContent().stream()
                .map(TenantShop::getDisplayName)
                .toList();
    }

    private static List<UUID> ids(Page<TenantShop> page) {
        return page.getContent().stream()
                .map(TenantShop::getId)
                .toList();
    }

    private static RaceFixture createRaceFixture(boolean createShop)
            throws Exception {
        resetPreviousRaceFixture();
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        String suffix = tenantId.toString().replace("-", "").substring(0, 16);
        executeUpdate("""
                INSERT INTO tenants (id, code, name)
                VALUES (?, ?, ?)
                """, tenantId, "lock_" + suffix, "Lock Tenant " + suffix);
        executeUpdate("""
                INSERT INTO users (
                    id, tenant_id, username, display_name, status)
                VALUES (?, ?, ?, ?, 'ACTIVE')
                """,
                userId,
                tenantId,
                "lock_actor_" + suffix,
                "Lock Actor " + suffix);
        ShopCenterActor actor = new ShopCenterActor(
                tenantId,
                userId,
                null,
                "shop-parent-lock-" + suffix,
                "127.0.0.1");
        PlatformCatalogEntry platform = service.createPlatform(
                actor,
                "SHOPIFY",
                "Lock Platform " + suffix,
                null
        );
        UUID shopId = null;
        if (createShop) {
            shopId = service.createShopWithDisplayName(
                    actor,
                    platform.getId(),
                    "lock-shop-" + suffix,
                    "Lock Shop " + suffix
            ).shop().getId();
        }
        return new RaceFixture(tenantId, platform.getId(), shopId, actor);
    }

    private static void resetPreviousRaceFixture() throws Exception {
        executeUpdate("""
                DELETE FROM shop_sync_jobs
                 WHERE shop_id IN (
                       SELECT shop.id
                         FROM tenant_shops shop
                         JOIN platform_catalog platform
                           ON platform.id = shop.platform_id
                        WHERE platform.code = 'SHOPIFY')
                """);
        executeUpdate("""
                DELETE FROM shop_authorizations
                 WHERE shop_id IN (
                       SELECT shop.id
                         FROM tenant_shops shop
                         JOIN platform_catalog platform
                           ON platform.id = shop.platform_id
                        WHERE platform.code = 'SHOPIFY')
                """);
        executeUpdate("""
                DELETE FROM tenant_shops
                 WHERE platform_id IN (
                       SELECT id FROM platform_catalog WHERE code = 'SHOPIFY')
                """);
        executeUpdate("DELETE FROM platform_catalog WHERE code = 'SHOPIFY'");
    }

    private static <W, L> RaceResult<W, L> runSerializedRace(
            Supplier<W> winner,
            Supplier<L> loser
    ) throws Exception {
        CountDownLatch winnerHoldingLock = new CountDownLatch(1);
        CountDownLatch releaseWinner = new CountDownLatch(1);
        CountDownLatch loserTransactionStarted = new CountDownLatch(1);
        String applicationName = "shop-parent-lock-" + UUID.randomUUID();

        try (var executor = Executors.newFixedThreadPool(2)) {
            Future<W> winnerFuture = executor.submit(() ->
                    Objects.requireNonNull(transactionTemplate.execute(status -> {
                        W value = winner.get();
                        winnerHoldingLock.countDown();
                        await(releaseWinner);
                        return value;
                    })));
            assertThat(winnerHoldingLock.await(10, TimeUnit.SECONDS)).isTrue();

            Future<Outcome<L>> loserFuture = executor.submit(() -> capture(() ->
                    transactionTemplate.execute(status -> {
                        jdbcTemplate.queryForObject(
                                "SELECT set_config('application_name', ?, true)",
                                String.class,
                                applicationName);
                        loserTransactionStarted.countDown();
                        return loser.get();
                    })));
            assertThat(loserTransactionStarted.await(10, TimeUnit.SECONDS)).isTrue();
            awaitPostgresqlLockWait(applicationName);
            releaseWinner.countDown();

            W winnerValue = winnerFuture.get(20, TimeUnit.SECONDS);
            Outcome<L> loserOutcome = loserFuture.get(20, TimeUnit.SECONDS);
            return new RaceResult<>(winnerValue, loserOutcome);
        } finally {
            releaseWinner.countDown();
        }
    }

    private static void awaitPostgresqlLockWait(String applicationName) {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            Integer waiting = jdbcTemplate.queryForObject("""
                    SELECT count(*)
                      FROM pg_stat_activity
                     WHERE datname = current_database()
                       AND application_name = ?
                       AND wait_event_type = 'Lock'
                    """, Integer.class, applicationName);
            if (waiting != null && waiting > 0) {
                return;
            }
            Thread.onSpinWait();
        }
        throw new AssertionError(
                "Competing transaction did not wait on the PostgreSQL parent row lock");
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(20, TimeUnit.SECONDS)) {
                throw new AssertionError("Timed out waiting for the transaction barrier");
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Transaction barrier was interrupted", exception);
        }
    }

    private static <T> Outcome<T> capture(Supplier<T> action) {
        try {
            return new Outcome<>(action.get(), null);
        } catch (Throwable failure) {
            return new Outcome<>(null, failure);
        }
    }

    private static void seedFixtures() throws Exception {
        executeUpdate("""
                INSERT INTO tenants (id, code, name)
                VALUES
                    (?, 'shop_filter_tenant_a', 'Shop Filter Tenant A'),
                    (?, 'shop_filter_tenant_b', 'Shop Filter Tenant B')
                """, TENANT_A, TENANT_B);
        executeUpdate("""
                INSERT INTO platform_catalog (id, code, display_name)
                VALUES
                    (?, 'FILTER_PLATFORM_A', 'Filter Platform A'),
                    (?, 'FILTER_PLATFORM_B', 'Filter Platform B')
                """, PLATFORM_A, PLATFORM_B);
        executeUpdate("""
                INSERT INTO tenant_shops (
                    id, tenant_id, platform_id, external_shop_ref, display_name, status
                ) VALUES
                    (?, ?, ?, 'alpha-ref', 'Alpha Needle', 'ACTIVE'),
                    (?, ?, ?, 'needle-ref', 'Beta Market', 'SUSPENDED'),
                    (?, ?, ?, 'delta-ref', 'Delta Market', 'ACTIVE'),
                    (?, ?, ?, 'gamma-ref', 'Gamma Archived', 'ARCHIVED'),
                    (?, ?, ?, 'omega-ref', 'Omega Platform B', 'ACTIVE'),
                    (?, ?, ?, 'duplicate-second-ref', 'Duplicate Shop', 'ACTIVE'),
                    (?, ?, ?, 'duplicate-first-ref', 'Duplicate Shop', 'ACTIVE'),
                    (?, ?, ?, 'foreign-private-ref', 'Foreign Private Shop', 'ACTIVE'),
                    (?, ?, ?, 'percent-literal-ref', 'Percent 100% Literal', 'ACTIVE'),
                    (?, ?, ?, 'percent-wildcard-ref', 'Percent 100X Literal', 'ACTIVE'),
                    (?, ?, ?, 'underscore-literal-ref', 'Underscore score_a Literal', 'ACTIVE'),
                    (?, ?, ?, 'underscore-wildcard-ref', 'Underscore scoreXa Literal', 'ACTIVE'),
                    (?, ?, ?, 'backslash-literal-ref', 'Path C:\\shop Literal', 'ACTIVE')
                """,
                ALPHA_SHOP, TENANT_A, PLATFORM_A,
                BETA_SHOP, TENANT_A, PLATFORM_A,
                DELTA_SHOP, TENANT_A, PLATFORM_A,
                GAMMA_ARCHIVED_SHOP, TENANT_A, PLATFORM_A,
                OMEGA_SHOP, TENANT_A, PLATFORM_B,
                SECOND_DUPLICATE_SHOP, TENANT_A, PLATFORM_A,
                FIRST_DUPLICATE_SHOP, TENANT_A, PLATFORM_A,
                FOREIGN_SHOP, TENANT_B, PLATFORM_A,
                PERCENT_LITERAL_SHOP, TENANT_B, PLATFORM_A,
                PERCENT_WILDCARD_SHOP, TENANT_B, PLATFORM_A,
                UNDERSCORE_LITERAL_SHOP, TENANT_B, PLATFORM_A,
                UNDERSCORE_WILDCARD_SHOP, TENANT_B, PLATFORM_A,
                BACKSLASH_LITERAL_SHOP, TENANT_B, PLATFORM_A);
        executeUpdate("""
                INSERT INTO shop_authorizations (
                    id, tenant_id, shop_id, status, credential_reference
                ) VALUES
                    (?, ?, ?, 'AUTHORIZED', 'credential://shop-filter/alpha'),
                    (?, ?, ?, 'PENDING', NULL),
                    (?, ?, ?, 'NOT_AUTHORIZED', NULL),
                    (?, ?, ?, 'AUTHORIZED', 'credential://shop-filter/gamma'),
                    (?, ?, ?, 'AUTHORIZED', 'credential://shop-filter/omega'),
                    (?, ?, ?, 'AUTHORIZED', 'credential://shop-filter/foreign')
                """,
                UUID.fromString("94000000-0000-0000-0000-000000000301"), TENANT_A, ALPHA_SHOP,
                UUID.fromString("94000000-0000-0000-0000-000000000302"), TENANT_A, BETA_SHOP,
                UUID.fromString("94000000-0000-0000-0000-000000000303"), TENANT_A, DELTA_SHOP,
                UUID.fromString("94000000-0000-0000-0000-000000000304"), TENANT_A, GAMMA_ARCHIVED_SHOP,
                UUID.fromString("94000000-0000-0000-0000-000000000305"), TENANT_A, OMEGA_SHOP,
                UUID.fromString("94000000-0000-0000-0000-000000000306"), TENANT_B, FOREIGN_SHOP);
    }

    private static void executeUpdate(String sql, Object... parameters)
            throws Exception {
        try (Connection connection = DriverManager.getConnection(
                        jdbcUrl, username, password);
                PreparedStatement statement = connection.prepareStatement(sql)) {
            for (int index = 0; index < parameters.length; index++) {
                statement.setObject(index + 1, parameters[index]);
            }
            statement.executeUpdate();
        }
    }

    private static String singleString(String sql) throws Exception {
        try (Connection connection = DriverManager.getConnection(
                        jdbcUrl, username, password);
                PreparedStatement statement = connection.prepareStatement(sql);
                ResultSet result = statement.executeQuery()) {
            result.next();
            return result.getString(1);
        }
    }

    private static String stringValue(String sql, Object... parameters)
            throws Exception {
        try (Connection connection = DriverManager.getConnection(
                        jdbcUrl, username, password);
                PreparedStatement statement = connection.prepareStatement(sql)) {
            for (int index = 0; index < parameters.length; index++) {
                statement.setObject(index + 1, parameters[index]);
            }
            try (ResultSet result = statement.executeQuery()) {
                result.next();
                return result.getString(1);
            }
        }
    }

    private static long longValue(String sql, Object... parameters)
            throws Exception {
        try (Connection connection = DriverManager.getConnection(
                        jdbcUrl, username, password);
                PreparedStatement statement = connection.prepareStatement(sql)) {
            for (int index = 0; index < parameters.length; index++) {
                statement.setObject(index + 1, parameters[index]);
            }
            try (ResultSet result = statement.executeQuery()) {
                result.next();
                return result.getLong(1);
            }
        }
    }

    private record RaceFixture(
            UUID tenantId,
            UUID platformId,
            UUID shopId,
            ShopCenterActor actor) {
    }

    private record RaceResult<W, L>(W winner, Outcome<L> loser) {
    }

    private record Outcome<T>(T value, Throwable failure) {
    }
}
