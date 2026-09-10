import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DynamicCodeExecutionGateError,
  inspectDynamicCodeExecutionGate,
  runDynamicCodeExecutionGate,
} from "./dynamic-code-execution-gate-check.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..", "..");
const RUNTIME_REPORT =
  "platform/backend/target/surefire-reports/TEST-cn.xzkj.erp.security." +
  "DynamicCodeExecutionSurfacePostgresql16GateTest.xml";
const temporaryRoots = [];

function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "xz-erp-dynamic-code-execution-"),
  );
  temporaryRoots.push(root);
  for (const relative of [
    "platform/backend/src/main",
    "platform/backend/src/test/java/cn/xzkj/erp/security/" +
      "DynamicCodeExecutionSurfacePostgresql16GateTest.java",
    "platform/backend/pom.xml",
    RUNTIME_REPORT,
  ]) {
    fs.cpSync(path.join(REPOSITORY_ROOT, relative), path.join(root, relative), {
      recursive: true,
    });
  }
  return root;
}

function write(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function edit(root, relative, transform) {
  const target = path.join(root, relative);
  const original = fs.readFileSync(target, "utf8");
  const changed = transform(original);
  assert.notEqual(changed, original, `fixture edit did not change ${relative}`);
  fs.writeFileSync(target, changed, "utf8");
}

function expectIssue(root, expectedCode) {
  assert.throws(
    () => runDynamicCodeExecutionGate(root),
    (error) =>
      error instanceof DynamicCodeExecutionGateError &&
      error.issues.some((value) => value.code === expectedCode),
  );
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the repository source and passing runtime report are deterministic", () => {
  const first = runDynamicCodeExecutionGate(REPOSITORY_ROOT);
  const second = runDynamicCodeExecutionGate(REPOSITORY_ROOT);
  assert.deepEqual(first, second);
  assert.deepEqual(first.summary, {
    javaFiles: 484,
    resourceFiles: 57,
    queryInvocations: 453,
    boundedDynamicSql: 96,
    loggerCalls: 6,
    objectMapperFiles: 4,
    jdbcTemplateFiles: 39,
    runtimeTests: 4,
    failures: 0,
    errors: 0,
    skipped: 0,
  });
});

test("Jackson polymorphic typing and native deserialization fail closed", () => {
  const root = fixture();
  write(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/security/UnsafeJsonInput.java",
    `
    package cn.xzkj.erp.security;
    import com.fasterxml.jackson.annotation.JsonTypeInfo;
    import java.io.ObjectInputStream;
    @JsonTypeInfo(use = JsonTypeInfo.Id.CLASS)
    class UnsafeJsonInput { ObjectInputStream input; }
    `,
  );
  const result = inspectDynamicCodeExecutionGate(root);
  assert.ok(
    result.issues.some(
      (value) => value.code === "JACKSON_POLYMORPHIC_TYPING",
    ),
  );
  assert.ok(
    result.issues.some(
      (value) => value.code === "JAVA_NATIVE_DESERIALIZATION",
    ),
  );
});

test("XML object parsing and unsafe SnakeYAML construction fail closed", () => {
  const root = fixture();
  write(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/security/UnsafeStructuredInput.java",
    `
    package cn.xzkj.erp.security;
    import java.beans.XMLDecoder;
    import org.yaml.snakeyaml.Yaml;
    class UnsafeStructuredInput {
      XMLDecoder xml;
      Object parse(String value) { return new Yaml().load(value); }
    }
    `,
  );
  const result = inspectDynamicCodeExecutionGate(root);
  assert.ok(
    result.issues.some(
      (value) => value.code === "XML_OBJECT_OR_EXTERNAL_ENTITY_API",
    ),
  );
  assert.ok(
    result.issues.some(
      (value) => value.code === "SNAKEYAML_UNSAFE_CONSTRUCTOR",
    ),
  );
});

test("expression JNDI reflection and process APIs fail closed", () => {
  const root = fixture();
  write(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/security/UnsafeExecution.java",
    `
    package cn.xzkj.erp.security;
    import javax.naming.InitialContext;
    import org.springframework.expression.spel.standard.SpelExpressionParser;
    class UnsafeExecution {
      Object run(String name) throws Exception {
        Class<?> type = Class.forName(name);
        new ProcessBuilder("probe").start();
        return new InitialContext().lookup("ldap://127.0.0.1:9/x");
      }
      Object expression(String value) {
        return new SpelExpressionParser().parseExpression(value);
      }
    }
    `,
  );
  const result = inspectDynamicCodeExecutionGate(root);
  for (const code of [
    "EXPRESSION_OR_TEMPLATE_ENGINE",
    "JNDI_LDAP_OR_RMI_API",
    "REFLECTIVE_CLASS_LOADING",
    "PROCESS_EXECUTION_API",
  ]) {
    assert.ok(result.issues.some((value) => value.code === code), code);
  }
});

test("new ObjectMapper JsonAnySetter and Serializable surfaces fail closed", () => {
  const root = fixture();
  write(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/security/LooseInput.java",
    `
    package cn.xzkj.erp.security;
    import com.fasterxml.jackson.annotation.JsonAnySetter;
    import java.io.Serializable;
    import tools.jackson.databind.ObjectMapper;
    class LooseInput implements Serializable {
      ObjectMapper mapper;
      @JsonAnySetter void accept(String name, Object value) { }
    }
    `,
  );
  const result = inspectDynamicCodeExecutionGate(root);
  assert.ok(
    result.issues.some(
      (value) => value.code === "OBJECT_MAPPER_SURFACE_ADDED",
    ),
  );
  assert.ok(
    result.issues.some(
      (value) => value.code === "JSON_ANY_SETTER_SURFACE_DRIFT",
    ),
  );
  assert.ok(
    result.issues.some(
      (value) => value.code === "SERIALIZABLE_SURFACE_DRIFT",
    ),
  );
});

test("dangerous dependencies plugins and application config fail closed", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/pom.xml",
    (content) =>
      content.replace(
        "</dependencies>",
        `
        <dependency>
          <groupId>org.apache.logging.log4j</groupId>
          <artifactId>log4j-core</artifactId>
        </dependency>
        </dependencies>
        `,
      ),
  );
  edit(
    root,
    "platform/backend/src/main/resources/application.yml",
    (content) =>
      `${content}\nspring:\n  jackson:\n    default-typing: enabled\n`,
  );
  const result = inspectDynamicCodeExecutionGate(root);
  assert.ok(
    result.issues.some(
      (value) => value.code === "DANGEROUS_DEPENDENCY_OR_PLUGIN",
    ),
  );
  assert.ok(
    result.issues.some(
      (value) => value.code === "DANGEROUS_POLYMORPHIC_CONFIG",
    ),
  );
});

test("dynamic SQL JPQL and expression interpolation fail closed", () => {
  const root = fixture();
  write(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/security/UnsafeQuery.java",
    `
    package cn.xzkj.erp.security;
    import org.springframework.data.jpa.repository.Query;
    class UnsafeQuery {
      void run(jakarta.persistence.EntityManager manager, String input) {
        manager.createNativeQuery("SELECT * FROM users WHERE name = '" + input + "'");
      }
      @Query("select user from User user where user.name = :#{#name}")
      void springExpressionQuery();
    }
    `,
  );
  const result = inspectDynamicCodeExecutionGate(root);
  assert.ok(
    result.issues.some(
      (value) => value.code === "DYNAMIC_QUERY_CONSTRUCTION",
    ),
  );
  assert.ok(
    result.issues.some(
      (value) => value.code === "QUERY_EXPRESSION_INTERPOLATION",
    ),
  );
});

test("the existing bounded audit SQL fragment cannot gain a dynamic column", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/iam/persistence/AuditLogQueryRepository.java",
    (content) =>
      content.replace(
        'appendFilter(where, parameters, "action", action);',
        'appendFilter(where, parameters, resourceType, action);',
      ),
  );
  expectIssue(root, "BOUNDED_DYNAMIC_SQL_DRIFT");
});

test("every reviewed JDBC owner is source-integrity locked", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/inventory/repository/InventoryStore.java",
    (content) => `${content}\n`,
  );
  expectIssue(root, "REVIEWED_JDBC_SOURCE_DRIFT");
});

test("parameterized or throwable application logging fails closed", () => {
  const root = fixture();
  write(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/security/UnsafeLogging.java",
    `
    package cn.xzkj.erp.security;
    import org.slf4j.Logger;
    import org.slf4j.LoggerFactory;
    class UnsafeLogging {
      private static final Logger logger =
          LoggerFactory.getLogger(UnsafeLogging.class);
      void log(String value) {
        logger.warn("request value {}", value);
      }
    }
    `,
  );
  const result = inspectDynamicCodeExecutionGate(root);
  assert.ok(
    result.issues.some(
      (value) => value.code === "DYNAMIC_OR_THROWABLE_LOGGING",
    ),
  );
  assert.ok(
    result.issues.some(
      (value) => value.code === "LOGGER_OWNER_SURFACE_DRIFT",
    ),
  );
});

test("runtime coverage markers and side-effect APIs are mandatory", () => {
  const root = fixture();
  const testSource =
    "platform/backend/src/test/java/cn/xzkj/erp/security/" +
    "DynamicCodeExecutionSurfacePostgresql16GateTest.java";
  edit(root, testSource, (content) =>
    content.replace(
      'import java.util.List;',
      "import java.util.List;\nimport java.net.Socket;",
    ),
  );
  const result = inspectDynamicCodeExecutionGate(root);
  assert.ok(
    result.issues.some(
      (value) => value.code === "RUNTIME_TEST_SIDE_EFFECT_API",
    ),
  );
});

test("missing failed skipped and zero-test runtime reports fail closed", () => {
  for (const attributes of [
    'tests="0" failures="0" errors="0" skipped="0"',
    'tests="4" failures="1" errors="0" skipped="0"',
    'tests="4" failures="0" errors="1" skipped="0"',
    'tests="4" failures="0" errors="0" skipped="1"',
  ]) {
    const root = fixture();
    write(root, RUNTIME_REPORT, `<testsuite ${attributes}></testsuite>`);
    expectIssue(root, "RUNTIME_RESULT_REJECTED");
  }
});

test("a runtime report older than gate-owned sources fails closed", () => {
  const root = fixture();
  const report = path.join(root, RUNTIME_REPORT);
  const old = new Date("2020-01-01T00:00:00Z");
  fs.utimesSync(report, old, old);
  expectIssue(root, "STALE_RUNTIME_REPORT");
});

test("symbolic source roots are rejected", () => {
  const root = fixture();
  const external = fs.mkdtempSync(
    path.join(os.tmpdir(), "xz-erp-dynamic-code-external-"),
  );
  temporaryRoots.push(external);
  write(external, "Outside.java", "class Outside { }");
  fs.symlinkSync(
    external,
    path.join(root, "platform/backend/src/main/java/__external"),
    "junction",
  );
  expectIssue(root, "SYMBOLIC_SOURCE_REJECTED");
});

test("the executable accepts no external inputs and reports zero skipped", () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(
        REPOSITORY_ROOT,
        "platform/scripts/dynamic-code-execution-gate-check.mjs",
      ),
      REPOSITORY_ROOT,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /\[EXTERNAL_INPUT_REJECTED\]/);
  assert.match(result.stderr, /skipped=0/);
});
