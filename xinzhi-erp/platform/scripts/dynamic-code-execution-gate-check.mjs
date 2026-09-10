import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIRECTORY = path.dirname(SCRIPT_PATH);
const LOCKED_REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..", "..");

const JAVA_ROOT = "platform/backend/src/main/java";
const RESOURCE_ROOT = "platform/backend/src/main/resources";
const POM = "platform/backend/pom.xml";
const RUNTIME_TEST =
  "platform/backend/src/test/java/cn/xzkj/erp/security/" +
  "DynamicCodeExecutionSurfacePostgresql16GateTest.java";
const RUNTIME_REPORT =
  "platform/backend/target/surefire-reports/TEST-cn.xzkj.erp.security." +
  "DynamicCodeExecutionSurfacePostgresql16GateTest.xml";

const SERIALIZABLE_ALLOWLIST = new Map([
  [
    "platform/backend/src/main/java/cn/xzkj/erp/iam/persistence/LoginThrottleId.java",
    2,
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/iam/warehousescope/WarehouseScopeId.java",
    2,
  ],
]);

const JSON_ANY_SETTER_ALLOWLIST = new Map([
  [
    "platform/backend/src/main/java/cn/xzkj/erp/iam/web/IamAdminController.java",
    3,
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/iam/web/PasswordCredentialAdminController.java",
    1,
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/iam/web/PasswordCredentialExchangeController.java",
    1,
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/platformadmin/web/PlatformAdminController.java",
    1,
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/product/api/ProductCenterDtos.java",
    5,
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/product/api/ProductImageDtos.java",
    1,
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/product/api/ProductMasterDataDtos.java",
    6,
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/procurement/api/ProcurementPlanDtos.java",
    3,
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/procurement/api/ProcurementPurchaseOrderDtos.java",
    2,
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/logistics/tracking/LogisticsTrackingController.java",
    1,
  ],
]);

const OBJECT_MAPPER_ALLOWLIST = new Map([
  [
    "platform/backend/src/main/java/cn/xzkj/erp/iam/persistence/AuditLogQueryRepository.java",
    {
      operations: ["readValue"],
      allowedUnsafeCalls: ["objectMapper.readValue(json, DETAILS_TYPE)"],
      requiredMarkers: ["TypeReference<Map<String, String>>"],
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/warehouse/operations/repository/ManualMovementStore.java",
    {
      operations: ["writeValueAsString", "readValue"],
      allowedUnsafeCalls: ["JSON.readValue(value, STRING_MAP)"],
      requiredMarkers: ["TypeReference<Map<String, String>>"],
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/warehouse/operations/repository/ManualMovementWorkflowStore.java",
    {
      operations: ["writeValueAsString", "readValue"],
      allowedUnsafeCalls: ["JSON.readValue(value, OBJECT_MAP)"],
      requiredMarkers: ["TypeReference<Map<String, Object>>"],
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/platform/connector/XzErpAppChannelConnectorGateway.java",
    {
      operations: [],
      allowedUnsafeCalls: [
        "mapper.readValue(response.body(), responseType)",
        "mapper.readValue(response.body(), responseType)",
        "STRICT_CONTRACT_JSON.readValue(\n                    body, ConnectorErrorResponse.class)",
      ],
      requiredMarkers: [
        "DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES",
        "DeserializationFeature.FAIL_ON_TRAILING_TOKENS",
        "Class<T> responseType",
      ],
    },
  ],
]);

const JDBC_TEMPLATE_ALLOWLIST = new Map([
  [
    "platform/backend/src/main/java/cn/xzkj/erp/analytics/inventoryperiod/InventoryPeriodReportRepository.java",
    {
      sha256: "71a1b8d3add5143c94123075129295e918ec2f3266b2a747f090b751f1d697ad",
      dynamicQueries: 2,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/analytics/inventorysales/InventoryRealtimeSalesRepository.java",
    {
      sha256: "7138076d3ffdde1382430a8043a12049d1f86d602f3641b1a0cb6c907ca5fa48",
      dynamicQueries: 2,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/analytics/listingsales/ListingRealtimeSalesRepository.java",
    {
      sha256: "d4d30d0ba17bd7d8eda0988238bb5465f121cac268e63b9e451b43937eabde08",
      dynamicQueries: 2,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/analytics/orderstatus/OrderStatusReportRepository.java",
    {
      sha256: "5fd19cd95978a15c593397b470fbebfbf0457c0145f2cab0210152685e3abcd1",
      dynamicQueries: 2,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/analytics/productboard/ProductSalesBoardRepository.java",
    {
      sha256: "b22ea426e0ee50d752824f63a7ac9d830a55633a6a3f054be8a30e92825da53b",
      dynamicQueries: 2,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/analytics/productsales/ProductSalesReportRepository.java",
    {
      sha256: "a9debb9e7872691925e5ac2a48a056bb508aebb97a47e9d6a7cefb1584201ba4",
      dynamicQueries: 2,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/iam/persistence/AuditLogQueryRepository.java",
    {
      sha256: "0ef8f10368c7a09191dc88a002c591e71ae61ec2a9ddd2fcef032a625d6b3210",
      dynamicQueries: 2,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/fulfillment/inventory/InventoryLedgerReservationAdapter.java",
    {
      sha256: "69ead96a3a61eed62fde6cbca45a5ee9c8b5a21cafda93440a17305c3e8315ac",
      dynamicQueries: 0,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/fulfillment/repository/FulfillmentRepository.java",
    {
      sha256: "f44cf8e0830893b3ea8d6ab6177239dd6ccc6b0499aef11d4a06f06930987908",
      dynamicQueries: 0,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/fulfillment/repository/ShopifyFulfillmentPublicationRepository.java",
    {
      sha256: "5229e459542aea8238ac31de410338d250d4673120c3fba0a5e12f357a5c55b9",
      dynamicQueries: 0,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/fulfillment/weighing/ShippingConfigurationRepository.java",
    {
      sha256: "9be91e79dc17a366da824582d0959f1093a9aaa7364a00a3c2ab471bcf8f993b",
      dynamicQueries: 1,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/fulfillment/weighing/ShippingWeighingRepository.java",
    {
      sha256: "766996d2976bdca974df19ae947d90b9be2f24062b935e0e97aa10143f098056",
      dynamicQueries: 1,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/logistics/address/LogisticsAddressRepository.java",
    {
      sha256: "965af2f077b786816a0235e2184571deea576640e5ce3a59fd64e24df2365550",
      dynamicQueries: 3,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/logistics/declaration/LogisticsDeclarationEntityRepository.java",
    {
      sha256: "c0c7f8ff8d7dc61223d7d27f741744c2e2d6d1f28aba121a497ec3361ff02228",
      dynamicQueries: 6,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/inventory/repository/InventoryCountRepository.java",
    {
      sha256: "b5ee048bc1a8401dded94cd53f761fac1546debd1df9bf64362bf2a48d549a21",
      dynamicQueries: 5,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/inventory/repository/InventoryStore.java",
    {
      sha256: "a6085759ddf1cc9e945b633a75da7fb3cbd1f50d5392a8a1d5946a083ba33c4b",
      dynamicQueries: 5,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/inventory/repository/ShopifyInventoryPublicationRepository.java",
    {
      sha256: "51efdf2e391e71dafae68d86d9bbf9433387a36614b9ec664d2e79eddf47f8d5",
      dynamicQueries: 2,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/inventory/repository/WarehouseTransferRepository.java",
    {
      sha256: "8783973962a9793b192b9161237beea4348a91ab99309a46afb990d0ae55ac97",
      dynamicQueries: 5,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/logistics/statistics/LogisticsStatisticsRepository.java",
    {
      sha256: "e963200ed9ea197c041ad4ed49cf5da42d7ebf824bf25688ccc23ca0eac63843",
      dynamicQueries: 3,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/logistics/tracking/LogisticsTrackingRepository.java",
    {
      sha256: "437e70c6a447e0d0e683f2138645b91bb7873c03eae78be11ee74241e46113d3",
      dynamicQueries: 2,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/logistics/trackingnumber/TrackingNumberRepository.java",
    {
      sha256: "1f8e4933cf803a6f439ef33401ba7faf5589145dd9aadacb6734d3404a1b56d0",
      dynamicQueries: 3,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/order/repository/OrderListQueryRepository.java",
    {
      sha256: "cf876ab1f783e4328a8ffddb887efb47955ea492fc74fe68b6b44e144e0a1e4c",
      dynamicQueries: 6,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/order/repository/OrderProfileStore.java",
    {
      sha256: "b4730b0fc3020e164aa7a8daf50f8f6aa7035ab332eb31b3d717bd56396b19db",
      dynamicQueries: 0,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/order/repository/OrderTransferRepository.java",
    {
      sha256: "fc9daf42d6e916f7710c013dac3486c1886c9a33cc11eb9d1ba3725226289a4e",
      dynamicQueries: 0,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/order/repository/ShopifyOrderCancellationCommandRepository.java",
    {
      sha256: "b212de03b823afc53bb208d140962ca40cce10b4d90d71d3fed96b18cd6b4440",
      dynamicQueries: 0,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/order/repository/ShopifyOrderCommandRepository.java",
    {
      sha256: "8be0c7019af8b937b7981875e767659cc2bc5434c4dce8a8ef80b83a61cc53c7",
      dynamicQueries: 0,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/order/repository/ShopifyOrderCustomItemCommandRepository.java",
    {
      sha256: "2c8c0c1c45645e564dd86e56014ac4af85b7b48637a3de8a978c30c59c1805ba",
      dynamicQueries: 0,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/order/repository/ShopifyOrderLineDiscountCommandRepository.java",
    {
      sha256: "ef70219e646dd9ca3ab8336907defdb8bac2044b7edb9732d609450456a938c9",
      dynamicQueries: 0,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/order/repository/ShopifyOrderLineEditCommandRepository.java",
    {
      sha256: "aaf7ad45a1a3dd66cd3bfb77eb0106a161087550754b6373c8f954b8e4c1ea63",
      dynamicQueries: 0,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/order/repository/ShopifyOrderVariantAddCommandRepository.java",
    {
      sha256: "d5ce9b0c02ec7c34200fe7a502fa58b11084cf5df2b969bf763ff2ceb08cb143",
      dynamicQueries: 0,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/platform/repository/ShopifyLocationMappingRepository.java",
    {
      sha256: "ea2322e0688868ed0bc067bccc330504d73c7f1a622349d1d268764d61763076",
      dynamicQueries: 0,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/product/repository/ProductSpuSensitiveAttributeRepository.java",
    {
      sha256: "a05f9149b768bcf82ae0dbb04e01431596325d50ddb41540fb637c422b5ed7e3",
      dynamicQueries: 0,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/procurement/repository/ProcurementPlanRepository.java",
    {
      sha256: "7d52c45ac8f144bb15bd471ca34e865ec4a3d2fbf08e84a8b4053a8eae4cbbe2",
      dynamicQueries: 12,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/procurement/repository/ProcurementPurchaseOrderRepository.java",
    {
      sha256: "d094de3028a856960840aee652831cd022640c273d34d8d7c4e927022e4c3875",
      dynamicQueries: 8,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/procurement/statistics/PurchaserStatisticsRepository.java",
    {
      sha256: "e6ca4459b3ab4a18ea733e1f977eff89831f228cc9da3d412184126590da5f06",
      dynamicQueries: 2,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/settings/approval/ApprovalRuleRepository.java",
    {
      sha256: "66bf1c99943272adc7643f5b2a037a87db1f9aec830075e30e2c13eabf5cdb65",
      dynamicQueries: 0,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/settings/branding/EnterpriseBrandingRepository.java",
    {
      sha256: "ccba804fd1c90705b3d36404eaaddc448894944cf63f907581de5d1f797646b6",
      dynamicQueries: 0,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/settings/enterprise/EnterpriseProfileRepository.java",
    {
      sha256: "f21b2253a28b40e5e2d7a9ee7ab4ad2ebaf0df9065e0ea10fb8d514e371bbf86",
      dynamicQueries: 0,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/warehouse/documents/WarehouseDocumentRepository.java",
    {
      sha256: "9fc354cd3937f076d88b74e4a14a611e0938477e30926a89125ab2757872e202",
      dynamicQueries: 2,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/warehouse/operations/repository/ManualMovementStore.java",
    {
      sha256: "a7bd1d0e65428e6195cfb8cfecff8f3d57d2739f7847c1615773465d54641f03",
      dynamicQueries: 10,
    },
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/warehouse/operations/repository/ManualMovementWorkflowStore.java",
    {
      sha256: "5ad3ce89c822cad2f0337939b9fe9e3b502b953e98a10c779563077ca5ffb44b",
      dynamicQueries: 6,
    },
  ],
]);

const LOGGER_OWNER_ALLOWLIST = new Map([
  [
    "platform/backend/src/main/java/cn/xzkj/erp/iam/security/BearerTokenAuthenticationFilter.java",
    1,
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/iam/web/IamExceptionHandler.java",
    1,
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/iam/web/PasswordCredentialExchangeExceptionHandler.java",
    1,
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/order/api/OrderApiExceptionHandler.java",
    1,
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/platform/api/ApiExceptionHandler.java",
    1,
  ],
  [
    "platform/backend/src/main/java/cn/xzkj/erp/platformadmin/web/PlatformAdminExceptionHandler.java",
    1,
  ],
]);

const DYNAMIC_SQL_ALLOWLIST =
  "platform/backend/src/main/java/cn/xzkj/erp/iam/persistence/" +
  "AuditLogQueryRepository.java";

const DANGEROUS_SOURCE_RULES = [
  [
    "JACKSON_POLYMORPHIC_TYPING",
    /\b(?:activateDefaultTyping|enableDefaultTyping|setDefaultTyping|DefaultTyping|PolymorphicTypeValidator)\b|@Json(?:TypeInfo|SubTypes|TypeName)\b|import\s+com\.fasterxml\.jackson\.annotation\.JsonType/gu,
  ],
  [
    "JAVA_NATIVE_DESERIALIZATION",
    /\b(?:ObjectInputStream|ObjectOutputStream|ObjectInputFilter|readUnshared|writeUnshared|readResolve|writeReplace)\b|(?<!objectMapper\.)\breadObject\s*\(/gu,
  ],
  [
    "XML_OBJECT_OR_EXTERNAL_ENTITY_API",
    /\b(?:XMLDecoder|XMLEncoder|XStream|JAXBContext|Unmarshaller|SAXParser|SAXParserFactory|DocumentBuilder|DocumentBuilderFactory|XMLInputFactory|XMLOutputFactory|TransformerFactory|SchemaFactory|SAXSource|InputSource)\b|import\s+(?:org\.xml\.sax|javax\.xml\.bind|jakarta\.xml\.bind|com\.thoughtworks\.xstream)\./gu,
  ],
  [
    "SNAKEYAML_UNSAFE_CONSTRUCTOR",
    /import\s+org\.yaml\.snakeyaml\.|\bnew\s+Yaml\s*\(|\b(?:Constructor|Representer)\s*\(/gu,
  ],
  [
    "EXPRESSION_OR_TEMPLATE_ENGINE",
    /\b(?:SpelExpressionParser|StandardEvaluationContext|SimpleEvaluationContext|ExpressionParser|ExpressionFactory|Ognl|MVEL|MvelExpression|ScriptEngine|ScriptEngineManager|GroovyShell|TemplateEngine|VelocityEngine|Handlebars|PebbleEngine|Jinjava)\b|import\s+(?:jakarta\.el|javax\.el|ognl|org\.mvel2|javax\.script|groovy\.lang|freemarker|org\.apache\.velocity|com\.github\.jknack\.handlebars|io\.pebbletemplates)\./gu,
  ],
  [
    "JNDI_LDAP_OR_RMI_API",
    /\b(?:InitialContext|InitialDirContext|NamingManager|RegistryContextFactory)\b|import\s+(?:javax\.naming|jakarta\.naming)\.|\b(?:jndi|ldap|ldaps|rmi):\/\//giu,
  ],
  [
    "REFLECTIVE_CLASS_LOADING",
    /\bClass\.forName\s*\(|\bloadClass\s*\(|\bdefineClass\s*\(|\bClassLoader\b|\bMethodHandles\.(?:Lookup|lookup)\b|import\s+java\.lang\.reflect\./gu,
  ],
  [
    "PROCESS_EXECUTION_API",
    /\bProcessBuilder\b|\bRuntime\.getRuntime\s*\(\s*\)\s*\.exec\s*\(|\bRuntime\s+[A-Za-z_$][\w$]*\b|\.exec\s*\(|\bstartPipeline\s*\(|import\s+java\.lang\.Process\b/gu,
  ],
  [
    "UNSAFE_JACKSON_CUSTOMIZATION",
    /@JsonDeserialize\b|@JsonCreator\b|@JsonAnyGetter\b|\b(?:ObjectReader|ObjectWriter|JsonMapper)\b|\b(?:registerSubtypes|addMixIn|treeToValue|convertValue|readerFor|readerForUpdating)\s*\(|\breadValue\s*\(/gu,
  ],
  [
    "DIRECT_STATEMENT_API",
    /import\s+java\.sql\.Statement\s*;|\bcreateStatement\s*\(/gu,
  ],
  [
    "DYNAMIC_QUERY_ANNOTATION",
    /@Named(?:Native)?Query\b|@SqlResultSetMapping\b/gu,
  ],
  [
    "UNREVIEWED_LOGGING_SURFACE",
    /\bSystem\.(?:out|err)\b|@Slf4j\b|import\s+org\.apache\.logging\.log4j\./gu,
  ],
];

const DANGEROUS_DEPENDENCIES = [
  "xstream",
  "snakeyaml",
  "jaxb-api",
  "jaxb-runtime",
  "xercesimpl",
  "woodstox-core",
  "spring-expression",
  "spring-boot-starter-thymeleaf",
  "spring-boot-starter-freemarker",
  "spring-boot-starter-mustache",
  "ognl",
  "mvel2",
  "groovy",
  "log4j-core",
  "unboundid-ldapsdk",
  "exec-maven-plugin",
  "groovy-maven-plugin",
];

const DANGEROUS_CONFIG_RULES = [
  [
    "DANGEROUS_POLYMORPHIC_CONFIG",
    /(?:default[-_. ]?typing|polymorphic[-_. ]?typing|type[-_. ]?resolver|type[-_. ]?id)/giu,
  ],
  [
    "DANGEROUS_LOOKUP_CONFIG",
    /(?:jndi|ldap|ldaps|rmi):|\blog4j2?\b|message[-_. ]?lookups?|script[-_. ]?engine/giu,
  ],
  [
    "DANGEROUS_XML_CONFIG",
    /(?:external[-_. ]?(?:general[-_. ]?entities|parameter[-_. ]?entities|dtd)|support[-_. ]?dtd)\s*[:=]\s*true/giu,
  ],
];

const QUERY_INVOCATIONS = [
  ".createNativeQuery",
  ".createQuery",
  "@Query",
  "jdbc.queryForObject",
  "jdbc.query",
  "jdbc.update",
  "jdbc.execute",
  "jdbc.getJdbcTemplate().queryForObject",
  "jdbc.getJdbcTemplate().batchUpdate",
];

const REQUIRED_RUNTIME_MARKERS = [
  'post("/api/v1/iam/members")',
  'post("/api/v1/platform-center/platforms")',
  'post("/api/v1/product-center/spus")',
  'post("/api/v1/order-center/orders")',
  "status().isBadRequest()",
  "status().isUnsupportedMediaType()",
  "java.lang.ProcessBuilder",
  "T(java.lang.Runtime)",
  "jndi:ldap://127.0.0.1:9/",
  "urn:xz-erp:xxe-canary",
  "${jndi:",
  "SHOW server_version",
  "assertNoDatabaseMutation",
  "assertCapturedLogsSafe",
];

export class DynamicCodeExecutionGateError extends Error {
  constructor(issues) {
    super(issues.map((value) => `[${value.code}] ${value.message}`).join("\n"));
    this.name = "DynamicCodeExecutionGateError";
    this.issues = issues;
  }
}

function issue(code, message) {
  return { code, message };
}

function repositoryRelative(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function resolveRequired(root, relative, expectedType = "file") {
  const absolute = path.resolve(root, relative);
  const back = path.relative(root, absolute);
  if (
    back === ".." ||
    back.startsWith(`..${path.sep}`) ||
    path.isAbsolute(back) ||
    !fs.existsSync(absolute)
  ) {
    throw new DynamicCodeExecutionGateError([
      issue("SOURCE_LAYOUT_INVALID", `required source is missing or unsafe: ${relative}`),
    ]);
  }
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) {
    throw new DynamicCodeExecutionGateError([
      issue("SYMBOLIC_SOURCE_REJECTED", `symbolic source is not accepted: ${relative}`),
    ]);
  }
  if (
    (expectedType === "file" && !stat.isFile()) ||
    (expectedType === "directory" && !stat.isDirectory())
  ) {
    throw new DynamicCodeExecutionGateError([
      issue("SOURCE_LAYOUT_INVALID", `required source has the wrong type: ${relative}`),
    ]);
  }
  return absolute;
}

function walkRegularFiles(root, relativeRoot) {
  const start = resolveRequired(root, relativeRoot, "directory");
  const files = [];
  const pending = [start];
  while (pending.length) {
    const current = pending.pop();
    const entries = fs
      .readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = repositoryRelative(root, absolute);
      if (entry.isSymbolicLink()) {
        throw new DynamicCodeExecutionGateError([
          issue("SYMBOLIC_SOURCE_REJECTED", `symbolic source is not accepted: ${relative}`),
        ]);
      }
      if (entry.isDirectory()) {
        pending.push(absolute);
      } else if (entry.isFile()) {
        files.push({ absolute, relative });
      } else {
        throw new DynamicCodeExecutionGateError([
          issue("SOURCE_LAYOUT_INVALID", `non-regular source is not accepted: ${relative}`),
        ]);
      }
    }
  }
  return files.sort((left, right) => left.relative.localeCompare(right.relative, "en"));
}

function readRequired(root, relative) {
  return fs.readFileSync(resolveRequired(root, relative), "utf8");
}

function matchCount(source, pattern) {
  return [...source.matchAll(new RegExp(pattern.source, pattern.flags))].length;
}

function lineNumber(source, index) {
  return source.slice(0, index).split("\n").length;
}

function addPatternIssues(issues, source, relative, code, pattern) {
  for (const match of source.matchAll(new RegExp(pattern.source, pattern.flags))) {
    issues.push(
      issue(code, `${relative}:${lineNumber(source, match.index)} requires security review`),
    );
  }
}

function inspectJavaSources(root, issues) {
  const files = walkRegularFiles(root, JAVA_ROOT);
  const javaFiles = files.filter((value) => value.relative.endsWith(".java"));
  const actualSerializable = new Map();
  const actualAnySetters = new Map();
  let loggerCalls = 0;
  let objectMapperFiles = 0;
  let jdbcTemplateFiles = 0;
  const actualLoggerOwners = new Map();

  for (const file of files) {
    if (!file.relative.endsWith(".java")) {
      issues.push(
        issue("UNEXPECTED_JAVA_ROOT_FILE", `${file.relative} is not a Java source file`),
      );
      continue;
    }
    const source = fs.readFileSync(file.absolute, "utf8");

    for (const [code, pattern] of DANGEROUS_SOURCE_RULES) {
      if (
        code === "UNSAFE_JACKSON_CUSTOMIZATION" &&
        OBJECT_MAPPER_ALLOWLIST.has(file.relative)
      ) {
        let reduced = source;
        for (const allowedCall of
          OBJECT_MAPPER_ALLOWLIST.get(file.relative).allowedUnsafeCalls) {
          reduced = reduced.replace(allowedCall, "");
        }
        addPatternIssues(issues, reduced, file.relative, code, pattern);
      } else {
        addPatternIssues(issues, source, file.relative, code, pattern);
      }
    }

    const serializableCount =
      matchCount(source, /import\s+java\.io\.Serializable\s*;/gu) +
      matchCount(source, /\bimplements\s+Serializable\b/gu);
    if (serializableCount) actualSerializable.set(file.relative, serializableCount);

    const anySetterCount = matchCount(source, /@JsonAnySetter\b/gu);
    if (anySetterCount) actualAnySetters.set(file.relative, anySetterCount);

    if (/\bObjectMapper\b/u.test(source)) {
      objectMapperFiles += 1;
      if (!OBJECT_MAPPER_ALLOWLIST.has(file.relative)) {
        issues.push(
          issue(
            "OBJECT_MAPPER_SURFACE_ADDED",
            `${file.relative} adds direct ObjectMapper use`,
          ),
        );
      }
    }

    if (/\b(?:JdbcTemplate|NamedParameterJdbcTemplate)\b/u.test(source)) {
      jdbcTemplateFiles += 1;
      if (!JDBC_TEMPLATE_ALLOWLIST.has(file.relative)) {
        issues.push(
          issue(
            "JDBC_TEMPLATE_SURFACE_ADDED",
            `${file.relative} adds direct JDBC template use`,
          ),
        );
      }
    }

    const loggerOwnerCount = matchCount(
      source,
      /\bLoggerFactory\.getLogger\s*\(/gu,
    );
    if (loggerOwnerCount) {
      actualLoggerOwners.set(file.relative, loggerOwnerCount);
    }

    loggerCalls += inspectLoggerCalls(source, file.relative, issues);
  }

  compareAllowlist(
    actualSerializable,
    SERIALIZABLE_ALLOWLIST,
    "SERIALIZABLE_SURFACE_DRIFT",
    issues,
  );
  compareAllowlist(
    actualAnySetters,
    JSON_ANY_SETTER_ALLOWLIST,
    "JSON_ANY_SETTER_SURFACE_DRIFT",
    issues,
  );
  compareAllowlist(
    actualLoggerOwners,
    LOGGER_OWNER_ALLOWLIST,
    "LOGGER_OWNER_SURFACE_DRIFT",
    issues,
  );

  for (const [relative, review] of JDBC_TEMPLATE_ALLOWLIST) {
    const source = readRequired(root, relative);
    const sourceHash = crypto
      .createHash("sha256")
      .update(Buffer.from(source, "utf8"))
      .digest("hex");
    if (
      sourceHash !== review.sha256 ||
      !/\b(?:JdbcTemplate|NamedParameterJdbcTemplate)\b/u.test(source)
    ) {
      issues.push(
        issue(
          "REVIEWED_JDBC_SOURCE_DRIFT",
          `${relative} changed after its JDBC and dynamic-query review`,
        ),
      );
    }
  }

  for (const [relative, review] of OBJECT_MAPPER_ALLOWLIST) {
    const mapper = readRequired(root, relative);
    const operations = [
      ...mapper.matchAll(/\b(?:objectMapper|JSON)\.([A-Za-z_$][\w$]*)\s*\(/gu),
    ].map((match) => match[1]);
    if (
      JSON.stringify(operations) !== JSON.stringify(review.operations) ||
      review.requiredMarkers.some((marker) => !mapper.includes(marker)) ||
      review.allowedUnsafeCalls.some((call) => !mapper.includes(call))
    ) {
      issues.push(
        issue(
          "OBJECT_MAPPER_ALLOWLIST_DRIFT",
          `${relative} changed after its typed JSON operation review`,
        ),
      );
    }
  }

  return {
    javaFiles: javaFiles.length,
    loggerCalls,
    objectMapperFiles,
    jdbcTemplateFiles,
  };
}

function compareAllowlist(actual, expected, code, issues) {
  const keys = new Set([...actual.keys(), ...expected.keys()]);
  for (const key of [...keys].sort()) {
    if (actual.get(key) !== expected.get(key)) {
      issues.push(
        issue(
          code,
          `${key} expected ${expected.get(key) ?? 0} occurrence(s), found ${actual.get(key) ?? 0}`,
        ),
      );
    }
  }
}

function inspectLoggerCalls(source, relative, issues) {
  const pattern = /\b(?:LOGGER|logger|log)\.(?:trace|debug|info|warn|error)\s*\(/gu;
  let count = 0;
  for (const match of source.matchAll(pattern)) {
    count += 1;
    const invocation = extractParenthesized(source, match.index + match[0].lastIndexOf("("));
    if (!invocation || !isStaticJavaString(invocation.content.trim())) {
      issues.push(
        issue(
          "DYNAMIC_OR_THROWABLE_LOGGING",
          `${relative}:${lineNumber(source, match.index)} log calls must contain exactly one fixed literal`,
        ),
      );
    }
  }
  return count;
}

function extractParenthesized(source, openIndex) {
  if (source[openIndex] !== "(") return null;
  let depth = 1;
  let state = "code";
  for (let index = openIndex + 1; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    const nextTwo = source.slice(index, index + 3);
    if (state === "lineComment") {
      if (current === "\n") state = "code";
      continue;
    }
    if (state === "blockComment") {
      if (current === "*" && next === "/") {
        state = "code";
        index += 1;
      }
      continue;
    }
    if (state === "string") {
      if (current === "\\") {
        index += 1;
      } else if (current === '"') {
        state = "code";
      }
      continue;
    }
    if (state === "char") {
      if (current === "\\") {
        index += 1;
      } else if (current === "'") {
        state = "code";
      }
      continue;
    }
    if (state === "textBlock") {
      if (nextTwo === '"""') {
        state = "code";
        index += 2;
      }
      continue;
    }
    if (current === "/" && next === "/") {
      state = "lineComment";
      index += 1;
    } else if (current === "/" && next === "*") {
      state = "blockComment";
      index += 1;
    } else if (nextTwo === '"""') {
      state = "textBlock";
      index += 2;
    } else if (current === '"') {
      state = "string";
    } else if (current === "'") {
      state = "char";
    } else if (current === "(") {
      depth += 1;
    } else if (current === ")") {
      depth -= 1;
      if (depth === 0) {
        return {
          content: source.slice(openIndex + 1, index),
          end: index,
        };
      }
    }
  }
  return null;
}

function splitFirstTopLevelArgument(content) {
  let depth = 0;
  let state = "code";
  for (let index = 0; index < content.length; index += 1) {
    const current = content[index];
    const next = content[index + 1];
    const nextTwo = content.slice(index, index + 3);
    if (state === "lineComment") {
      if (current === "\n") state = "code";
      continue;
    }
    if (state === "blockComment") {
      if (current === "*" && next === "/") {
        state = "code";
        index += 1;
      }
      continue;
    }
    if (state === "string") {
      if (current === "\\") index += 1;
      else if (current === '"') state = "code";
      continue;
    }
    if (state === "char") {
      if (current === "\\") index += 1;
      else if (current === "'") state = "code";
      continue;
    }
    if (state === "textBlock") {
      if (nextTwo === '"""') {
        state = "code";
        index += 2;
      }
      continue;
    }
    if (current === "/" && next === "/") {
      state = "lineComment";
      index += 1;
    } else if (current === "/" && next === "*") {
      state = "blockComment";
      index += 1;
    } else if (nextTwo === '"""') {
      state = "textBlock";
      index += 2;
    } else if (current === '"') {
      state = "string";
    } else if (current === "'") {
      state = "char";
    } else if ("([{".includes(current)) {
      depth += 1;
    } else if (")]}".includes(current)) {
      depth -= 1;
    } else if (current === "," && depth === 0) {
      return content.slice(0, index);
    }
  }
  return content;
}

function isStaticJavaString(expression) {
  const trimmed = expression.trim().replace(/^value\s*=\s*/u, "");
  return (
    /^"(?:[^"\\]|\\.)*"$/su.test(trimmed) ||
    /^"""[\s\S]*"""$/u.test(trimmed)
  );
}

function javaCodeWithoutLiterals(source) {
  let output = "";
  let state = "code";
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    const nextTwo = source.slice(index, index + 3);
    if (state === "lineComment") {
      if (current === "\n") {
        state = "code";
        output += "\n";
      } else {
        output += " ";
      }
      continue;
    }
    if (state === "blockComment") {
      if (current === "*" && next === "/") {
        output += "  ";
        state = "code";
        index += 1;
      } else {
        output += current === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (state === "string") {
      if (current === "\\") {
        output += "  ";
        index += 1;
      } else if (current === '"') {
        output += " ";
        state = "code";
      } else {
        output += current === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (state === "char") {
      if (current === "\\") {
        output += "  ";
        index += 1;
      } else if (current === "'") {
        output += " ";
        state = "code";
      } else {
        output += current === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (state === "textBlock") {
      if (nextTwo === '"""') {
        output += "   ";
        state = "code";
        index += 2;
      } else {
        output += current === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (current === "/" && next === "/") {
      output += "  ";
      state = "lineComment";
      index += 1;
    } else if (current === "/" && next === "*") {
      output += "  ";
      state = "blockComment";
      index += 1;
    } else if (nextTwo === '"""') {
      output += "   ";
      state = "textBlock";
      index += 2;
    } else if (current === '"') {
      output += " ";
      state = "string";
    } else if (current === "'") {
      output += " ";
      state = "char";
    } else {
      output += current;
    }
  }
  return output;
}

function inspectQueryConstruction(root, issues) {
  const files = walkRegularFiles(root, JAVA_ROOT).filter((value) =>
    value.relative.endsWith(".java"),
  );
  let queryInvocations = 0;
  let boundedDynamicSql = 0;
  const actualDynamicQueries = new Map();
  for (const file of files) {
    const source = fs.readFileSync(file.absolute, "utf8");
    for (const token of QUERY_INVOCATIONS) {
      let offset = 0;
      while (offset < source.length) {
        const index = source.indexOf(token, offset);
        if (index === -1) break;
        const openIndex = source.indexOf("(", index + token.length);
        if (
          openIndex === -1 ||
          source.slice(index + token.length, openIndex).trim() !== ""
        ) {
          offset = index + token.length;
          continue;
        }
        const invocation = extractParenthesized(source, openIndex);
        if (!invocation) {
          issues.push(
            issue(
              "QUERY_PARSE_FAILED",
              `${file.relative}:${lineNumber(source, index)} query invocation is incomplete`,
            ),
          );
          offset = openIndex + 1;
          continue;
        }
        queryInvocations += 1;
        const first = splitFirstTopLevelArgument(invocation.content);
        if (!isStaticJavaString(first)) {
          const jdbcReview = JDBC_TEMPLATE_ALLOWLIST.get(file.relative);
          if (
            jdbcReview?.dynamicQueries > 0 &&
            token.startsWith("jdbc.")
          ) {
            boundedDynamicSql += 1;
            actualDynamicQueries.set(
              file.relative,
              (actualDynamicQueries.get(file.relative) ?? 0) + 1,
            );
          } else {
            issues.push(
              issue(
                "DYNAMIC_QUERY_CONSTRUCTION",
                `${file.relative}:${lineNumber(source, index)} query text is not a fixed literal`,
              ),
            );
          }
        } else if (/[$#]\{/u.test(first)) {
          issues.push(
            issue(
              "QUERY_EXPRESSION_INTERPOLATION",
              `${file.relative}:${lineNumber(source, index)} query literal contains expression interpolation`,
            ),
          );
        }
        offset = invocation.end + 1;
      }
    }
  }

  for (const [relative, review] of JDBC_TEMPLATE_ALLOWLIST) {
    const actual = actualDynamicQueries.get(relative) ?? 0;
    if (actual !== review.dynamicQueries) {
      issues.push(
        issue(
          "BOUNDED_DYNAMIC_SQL_DRIFT",
          `${relative} expected ${review.dynamicQueries} reviewed dynamic query invocation(s), found ${actual}`,
        ),
      );
    }
  }

  const dynamicSource = readRequired(root, DYNAMIC_SQL_ALLOWLIST);
  const jdbcOperations = [
    ...dynamicSource.matchAll(/\bjdbc\.([A-Za-z_$][\w$]*)\s*\(/gu),
  ].map((value) => value[1]);
  const requiredFragments = [
    'new StringBuilder(" WHERE tenant_id = :tenantId")',
    'appendFilter(where, parameters, "action", action)',
    'appendFilter(where, parameters, "resource_type", resourceType)',
    'private static void appendFilter(',
    'where.append(" AND ").append(column).append(" = :").append(column)',
    "parameters.addValue(column, value)",
  ];
  if (
    (actualDynamicQueries.get(DYNAMIC_SQL_ALLOWLIST) ?? 0) !== 2 ||
    JSON.stringify(jdbcOperations) !==
      JSON.stringify(["queryForObject", "query"]) ||
    matchCount(dynamicSource, /\bNamedParameterJdbcTemplate\b/gu) !== 3 ||
    requiredFragments.some((fragment) => !dynamicSource.includes(fragment)) ||
    matchCount(dynamicSource, /appendFilter\s*\(/gu) !== 3 ||
    matchCount(dynamicSource, /\+\s*where\b/gu) !== 2
  ) {
    issues.push(
      issue(
        "BOUNDED_DYNAMIC_SQL_DRIFT",
        "AuditLogQueryRepository must retain exactly two parameterized queries and two fixed-column filter call sites",
      ),
    );
  }
  return { queryInvocations, boundedDynamicSql };
}

function inspectDependencies(root, issues) {
  const pom = readRequired(root, POM);
  for (const dependency of DANGEROUS_DEPENDENCIES) {
    if (new RegExp(`<artifactId>\\s*${dependency}\\s*</artifactId>`, "iu").test(pom)) {
      issues.push(
        issue(
          "DANGEROUS_DEPENDENCY_OR_PLUGIN",
          `${POM} declares review-required artifact ${dependency}`,
        ),
      );
    }
  }
}

function inspectResources(root, issues) {
  const files = walkRegularFiles(root, RESOURCE_ROOT);
  for (const file of files) {
    if (file.relative.includes("/db/migration/")) continue;
    const source = fs.readFileSync(file.absolute, "utf8");
    for (const [code, pattern] of DANGEROUS_CONFIG_RULES) {
      addPatternIssues(issues, source, file.relative, code, pattern);
    }
  }
  const application = readRequired(
    root,
    "platform/backend/src/main/resources/application.yml",
  );
  if (
    !/fail-on-unknown-properties:\s*true/u.test(application) ||
    /fail-on-unknown-properties:\s*false/u.test(application)
  ) {
    issues.push(
      issue(
        "UNKNOWN_PROPERTY_POLICY_DRIFT",
        "Jackson must retain fail-on-unknown-properties=true",
      ),
    );
  }
  return files.length;
}

function inspectRuntimeTest(root, issues) {
  const source = readRequired(root, RUNTIME_TEST);
  for (const marker of REQUIRED_RUNTIME_MARKERS) {
    if (!source.includes(marker)) {
      issues.push(
        issue(
          "RUNTIME_COVERAGE_DRIFT",
          `${RUNTIME_TEST} is missing required marker ${marker}`,
        ),
      );
    }
  }
  const executableCode = javaCodeWithoutLiterals(source);
  const forbiddenExecutableTestApis = [
    "java.net.",
    "javax.naming.",
    "jakarta.naming.",
    "ObjectInputStream",
    "XMLDecoder",
    "ProcessBuilder(",
    "Runtime.getRuntime()",
    "Class.forName(",
  ];
  for (const marker of forbiddenExecutableTestApis) {
    if (executableCode.includes(marker)) {
      issues.push(
        issue(
          "RUNTIME_TEST_SIDE_EFFECT_API",
          `${RUNTIME_TEST} must not invoke or import ${marker}`,
        ),
      );
    }
  }
}

function parseSuiteAttribute(xml, name) {
  const suite = xml.match(/<testsuite\b[^>]*>/u)?.[0];
  return suite?.match(new RegExp(`\\b${name}="([0-9]+)"`, "u"))?.[1] ?? null;
}

function inspectRuntimeReport(root, issues) {
  const reportPath = resolveRequired(root, RUNTIME_REPORT);
  const report = fs.readFileSync(reportPath, "utf8");
  const evidenceSources = [
    ...walkRegularFiles(root, JAVA_ROOT),
    ...walkRegularFiles(root, RESOURCE_ROOT),
    { absolute: resolveRequired(root, POM) },
    { absolute: resolveRequired(root, RUNTIME_TEST) },
  ];
  const newestSource = Math.max(
    ...evidenceSources.map((value) => fs.statSync(value.absolute).mtimeMs),
  );
  if (fs.statSync(reportPath).mtimeMs < newestSource) {
    issues.push(
      issue(
        "STALE_RUNTIME_REPORT",
        `${RUNTIME_REPORT} predates a gate-owned backend source`,
      ),
    );
  }
  const tests = Number.parseInt(parseSuiteAttribute(report, "tests") ?? "-1", 10);
  const failures = Number.parseInt(
    parseSuiteAttribute(report, "failures") ?? "-1",
    10,
  );
  const errors = Number.parseInt(parseSuiteAttribute(report, "errors") ?? "-1", 10);
  const skipped = Number.parseInt(
    parseSuiteAttribute(report, "skipped") ?? "-1",
    10,
  );
  if (
    tests !== 4 ||
    failures !== 0 ||
    errors !== 0 ||
    skipped !== 0 ||
    /<(?:failure|error|skipped)\b/u.test(report)
  ) {
    issues.push(
      issue(
        "RUNTIME_RESULT_REJECTED",
        `${RUNTIME_REPORT} must report tests=4, failures=0, errors=0, skipped=0`,
      ),
    );
  }
  return { tests, failures, errors, skipped };
}

export function inspectDynamicCodeExecutionGate(repositoryRoot) {
  const root = path.resolve(repositoryRoot);
  const issues = [];
  let java = {
    javaFiles: 0,
    loggerCalls: 0,
    objectMapperFiles: 0,
    jdbcTemplateFiles: 0,
  };
  let queries = { queryInvocations: 0, boundedDynamicSql: 0 };
  let resourceFiles = 0;
  let runtime = { tests: -1, failures: -1, errors: -1, skipped: -1 };
  try {
    java = inspectJavaSources(root, issues);
    queries = inspectQueryConstruction(root, issues);
    inspectDependencies(root, issues);
    resourceFiles = inspectResources(root, issues);
    inspectRuntimeTest(root, issues);
    runtime = inspectRuntimeReport(root, issues);
  } catch (error) {
    if (error instanceof DynamicCodeExecutionGateError) {
      issues.push(...error.issues);
    } else {
      issues.push(
        issue(
          "CHECKER_INTERNAL_FAILURE",
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }
  issues.sort(
    (left, right) =>
      left.code.localeCompare(right.code, "en") ||
      left.message.localeCompare(right.message, "en"),
  );
  return {
    issues,
    summary: {
      javaFiles: java.javaFiles,
      resourceFiles,
      queryInvocations: queries.queryInvocations,
      boundedDynamicSql: queries.boundedDynamicSql,
      loggerCalls: java.loggerCalls,
      objectMapperFiles: java.objectMapperFiles,
      jdbcTemplateFiles: java.jdbcTemplateFiles,
      runtimeTests: runtime.tests,
      failures: runtime.failures,
      errors: runtime.errors,
      skipped: runtime.skipped,
    },
  };
}

export function runDynamicCodeExecutionGate(repositoryRoot) {
  const result = inspectDynamicCodeExecutionGate(repositoryRoot);
  if (result.issues.length) {
    throw new DynamicCodeExecutionGateError(result.issues);
  }
  return result;
}

function printSummary(result, passed) {
  const summary = result.summary;
  const line =
    `Dynamic code execution surface gate ${passed ? "PASS" : "FAIL"}: ` +
    `javaFiles=${summary.javaFiles}, resourceFiles=${summary.resourceFiles}, ` +
    `queryInvocations=${summary.queryInvocations}, ` +
    `boundedDynamicSql=${summary.boundedDynamicSql}, ` +
    `loggerCalls=${summary.loggerCalls}, objectMapperFiles=${summary.objectMapperFiles}, ` +
    `jdbcTemplateFiles=${summary.jdbcTemplateFiles}, ` +
    `runtimeTests=${summary.runtimeTests}, failures=${summary.failures}, ` +
    `errors=${summary.errors}, skipped=${summary.skipped}`;
  (passed ? console.log : console.error)(line);
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  if (process.argv.length !== 2) {
    const failure = {
      issues: [
        issue(
          "EXTERNAL_INPUT_REJECTED",
          "this fixed-root gate accepts no path, URL, environment, credential, or other input",
        ),
      ],
      summary: {
        javaFiles: 0,
        resourceFiles: 0,
        queryInvocations: 0,
        boundedDynamicSql: 0,
        loggerCalls: 0,
        objectMapperFiles: 0,
        jdbcTemplateFiles: 0,
        runtimeTests: 0,
        failures: 0,
        errors: 0,
        skipped: 0,
      },
    };
    console.error(failure.issues.map((value) => `[${value.code}] ${value.message}`).join("\n"));
    printSummary(failure, false);
    process.exitCode = 2;
  } else {
    const result = inspectDynamicCodeExecutionGate(LOCKED_REPOSITORY_ROOT);
    if (result.issues.length) {
      console.error(
        result.issues.map((value) => `[${value.code}] ${value.message}`).join("\n"),
      );
      printSummary(result, false);
      process.exitCode = 1;
    } else {
      printSummary(result, true);
    }
  }
}
