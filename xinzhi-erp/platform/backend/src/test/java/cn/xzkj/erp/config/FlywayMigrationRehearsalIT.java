package cn.xzkj.erp.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.FlywayException;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.Test;

class FlywayMigrationRehearsalIT {

    private static final Pattern MIGRATION_NAME =
            Pattern.compile("^V([1-9][0-9]*)__"
                    + "[A-Za-z0-9][A-Za-z0-9_-]*\\.sql$");
    private static final String MIGRATION_LOCATION =
            "classpath:db/migration";
    private static final String REHEARSAL_ENABLED =
            "XZ_ERP_FLYWAY_REHEARSAL";
    private static final String JDBC_URL =
            "XZ_ERP_FLYWAY_REHEARSAL_JDBC_URL";
    private static final String USER =
            "XZ_ERP_FLYWAY_REHEARSAL_USER";
    private static final String PASSWORD =
            "XZ_ERP_FLYWAY_REHEARSAL_PASSWORD";
    private static final String EVIDENCE =
            "XZ_ERP_FLYWAY_REHEARSAL_EVIDENCE";

    @Test
    void rehearsesImmutableMigrationsOnIsolatedPostgres16()
            throws Exception {
        assertThat(System.getenv(REHEARSAL_ENABLED)).isEqualTo("true");
        String jdbcUrl = requiredEnvironment(JDBC_URL);
        String username = requiredEnvironment(USER);
        String password = requiredEnvironment(PASSWORD);
        Path evidence = Path.of(requiredEnvironment(EVIDENCE))
                .toAbsolutePath()
                .normalize();
        assertLoopbackJdbcUrl(jdbcUrl);
        assertThat(Files.exists(evidence)).isFalse();

        Path migrationSource = Path.of(
                "src",
                "main",
                "resources",
                "db",
                "migration").toAbsolutePath().normalize();
        assertThat(Files.isDirectory(migrationSource)).isTrue();
        List<Path> migrations = migrationFiles(migrationSource);
        int migrationCount = migrations.size();
        int latestVersion = versionOf(migrations.get(migrationCount - 1));
        assertThat(latestVersion).isGreaterThanOrEqualTo(39);

        assertPostgres16(jdbcUrl, username, password);
        AtomicBoolean applicationStarted = new AtomicBoolean(false);
        Path temporaryRoot = Files.createTempDirectory(
                evidence.getParent(),
                "java-flyway-fixtures-");

        try {
            Flyway empty = flyway(
                    jdbcUrl,
                    username,
                    password,
                    "empty_database",
                    MIGRATION_LOCATION);
            assertThat(empty.migrate().migrationsExecuted)
                    .isEqualTo(migrationCount);
            assertCurrentVersion(empty, latestVersion);
            empty.validate();
            assertThat(empty.info().pending()).isEmpty();
            assertSuccessfulHistory(
                    jdbcUrl,
                    username,
                    password,
                    "empty_database",
                    migrationCount);

            Flyway atV38 = flywayConfiguration(
                    jdbcUrl,
                    username,
                    password,
                    "upgrade_from_v38",
                    MIGRATION_LOCATION)
                    .target(MigrationVersion.fromVersion("38"))
                    .load();
            atV38.migrate();
            assertCurrentVersion(atV38, 38);
            Flyway upgraded = flyway(
                    jdbcUrl,
                    username,
                    password,
                    "upgrade_from_v38",
                    MIGRATION_LOCATION);
            assertThat(upgraded.migrate().migrationsExecuted)
                    .isEqualTo((int) (migrationCount
                            - migrations.stream()
                                    .filter(path -> versionOf(path) <= 38)
                                    .count()));
            assertCurrentVersion(upgraded, latestVersion);
            upgraded.validate();
            assertThat(upgraded.info().pending()).isEmpty();

            Path duplicateLocation = temporaryRoot.resolve("duplicate");
            copyMigrations(migrations, duplicateLocation);
            Path latest = migrations.get(migrations.size() - 1);
            Files.copy(
                    latest,
                    duplicateLocation.resolve(
                            "V" + latestVersion + "__duplicate.sql"),
                    StandardCopyOption.COPY_ATTRIBUTES);
            assertThat(isDeliverable(flyway(
                    jdbcUrl,
                    username,
                    password,
                    "duplicate_rejected",
                    fileSystemLocation(duplicateLocation))))
                    .isFalse();
            assertThatThrownBy(() -> flyway(
                    jdbcUrl,
                    username,
                    password,
                    "duplicate_hard_failure",
                    fileSystemLocation(duplicateLocation)).migrate())
                    .isInstanceOf(FlywayException.class);

            Flyway tamperOriginal = flyway(
                    jdbcUrl,
                    username,
                    password,
                    "tamper_rejected",
                    MIGRATION_LOCATION);
            tamperOriginal.migrate();
            Path tamperedLocation = temporaryRoot.resolve("tampered");
            copyMigrations(migrations, tamperedLocation);
            Files.writeString(
                    tamperedLocation.resolve(latest.getFileName()),
                    "\n-- deliberate rehearsal tamper\n",
                    StandardCharsets.UTF_8,
                    StandardOpenOption.APPEND);
            Flyway tampered = flyway(
                    jdbcUrl,
                    username,
                    password,
                    "tamper_rejected",
                    fileSystemLocation(tamperedLocation));
            assertThat(isDeliverable(tampered)).isFalse();
            assertThatThrownBy(tampered::validate)
                    .isInstanceOf(FlywayException.class);

            assertThat(applicationStarted).isFalse();
            Files.writeString(
                    evidence,
                    evidenceJson(latestVersion, migrationCount),
                    StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE_NEW);
        } finally {
            removeOwnedTemporaryDirectory(
                    temporaryRoot,
                    evidence.getParent());
        }
    }

    private static org.flywaydb.core.api.configuration.FluentConfiguration
            flywayConfiguration(
                    String jdbcUrl,
                    String username,
                    String password,
                    String schema,
                    String location) {
        return Flyway.configure()
                .dataSource(jdbcUrl, username, password)
                .locations(location)
                .schemas(schema)
                .defaultSchema(schema)
                .createSchemas(true)
                .cleanDisabled(true)
                .outOfOrder(false);
    }

    private static Flyway flyway(
            String jdbcUrl,
            String username,
            String password,
            String schema,
            String location) {
        return flywayConfiguration(
                jdbcUrl,
                username,
                password,
                schema,
                location).load();
    }

    private static boolean isDeliverable(Flyway flyway) {
        try {
            flyway.migrate();
            flyway.validate();
            return flyway.info().pending().length == 0;
        } catch (FlywayException expectedFailure) {
            return false;
        }
    }

    private static void assertCurrentVersion(
            Flyway flyway,
            int expectedVersion) {
        assertThat(flyway.info().current())
                .isNotNull();
        assertThat(flyway.info().current().getVersion().getVersion())
                .isEqualTo(String.valueOf(expectedVersion));
    }

    private static void assertPostgres16(
            String jdbcUrl,
            String username,
            String password) throws Exception {
        try (Connection connection =
                        DriverManager.getConnection(
                                jdbcUrl,
                                username,
                                password);
                Statement statement = connection.createStatement();
                ResultSet result =
                        statement.executeQuery("SHOW server_version_num")) {
            assertThat(result.next()).isTrue();
            assertThat(Integer.parseInt(result.getString(1)) / 10_000)
                    .isEqualTo(16);
        }
    }

    private static void assertSuccessfulHistory(
            String jdbcUrl,
            String username,
            String password,
            String schema,
            int expectedCount) throws Exception {
        assertThat(schema).matches("[a-z0-9_]+");
        try (Connection connection =
                        DriverManager.getConnection(
                                jdbcUrl,
                                username,
                                password);
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery(
                        "SELECT count(*), "
                                + "count(*) FILTER (WHERE success) "
                                + "FROM " + schema
                                + ".flyway_schema_history "
                                + "WHERE version IS NOT NULL")) {
            assertThat(result.next()).isTrue();
            assertThat(result.getInt(1)).isEqualTo(expectedCount);
            assertThat(result.getInt(2)).isEqualTo(expectedCount);
        }
    }

    private static List<Path> migrationFiles(Path directory)
            throws Exception {
        final long entryCount;
        try (Stream<Path> entries = Files.list(directory)) {
            entryCount = entries.count();
        }
        try (Stream<Path> stream = Files.list(directory)) {
            List<Path> migrations = stream
                    .filter(Files::isRegularFile)
                    .filter(path -> MIGRATION_NAME
                            .matcher(path.getFileName().toString())
                            .matches())
                    .sorted(Comparator
                            .comparingInt(
                                    FlywayMigrationRehearsalIT::versionOf)
                            .thenComparing(path ->
                                    path.getFileName().toString()))
                    .toList();
            assertThat(migrations).isNotEmpty();
            assertThat(migrations).hasSize((int) entryCount);
            int previous = 0;
            for (Path migration : migrations) {
                int version = versionOf(migration);
                assertThat(version).isGreaterThan(previous);
                previous = version;
            }
            return migrations;
        }
    }

    private static int versionOf(Path migration) {
        Matcher matcher = MIGRATION_NAME.matcher(
                migration.getFileName().toString());
        if (!matcher.matches()) {
            throw new IllegalArgumentException("invalid migration filename");
        }
        return Integer.parseInt(matcher.group(1));
    }

    private static void copyMigrations(
            List<Path> migrations,
            Path targetDirectory) throws Exception {
        Files.createDirectory(targetDirectory);
        for (Path migration : migrations) {
            Files.copy(
                    migration,
                    targetDirectory.resolve(migration.getFileName()),
                    StandardCopyOption.COPY_ATTRIBUTES);
        }
    }

    private static String fileSystemLocation(Path directory) {
        return "filesystem:"
                + directory.toAbsolutePath()
                        .normalize()
                        .toString()
                        .replace('\\', '/');
    }

    private static void assertLoopbackJdbcUrl(String jdbcUrl) {
        assertThat(jdbcUrl).startsWith("jdbc:postgresql://");
        URI uri = URI.create(jdbcUrl.substring("jdbc:".length()));
        assertThat(uri.getScheme()).isEqualTo("postgresql");
        assertThat(uri.getUserInfo()).isNull();
        assertThat(uri.getHost()).isIn("127.0.0.1", "localhost");
        assertThat(uri.getPort()).isBetween(1, 65_535);
        assertThat(uri.getPath()).matches("/[A-Za-z0-9_]+");
    }

    private static String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(
                    "rehearsal environment is incomplete");
        }
        return value;
    }

    private static String evidenceJson(
            int latestVersion,
            int migrationCount) {
        return """
                {
                  "schemaVersion": 1,
                  "postgresMajor": 16,
                  "latestVersion": "%d",
                  "migrationCount": %d,
                  "skipped": 0,
                  "checks": {
                    "emptyDatabaseV1ToLatest": true,
                    "upgradeV38ToLatest": true,
                    "validateSucceeded": true,
                    "duplicateRejected": true,
                    "tamperRejected": true,
                    "failedDatabaseNotDeliverable": true,
                    "applicationNotStarted": true
                  }
                }
                """.formatted(latestVersion, migrationCount);
    }

    private static void removeOwnedTemporaryDirectory(
            Path directory,
            Path expectedParent) throws Exception {
        Path normalizedDirectory = directory.toAbsolutePath().normalize();
        Path normalizedParent = expectedParent.toAbsolutePath().normalize();
        assertThat(normalizedDirectory.getParent())
                .isEqualTo(normalizedParent);
        assertThat(normalizedDirectory.getFileName().toString())
                .startsWith("java-flyway-fixtures-");
        try (Stream<Path> stream = Files.walk(normalizedDirectory)) {
            for (Path path : stream
                    .sorted(Comparator.reverseOrder())
                    .toList()) {
                Files.delete(path);
            }
        }
    }
}
