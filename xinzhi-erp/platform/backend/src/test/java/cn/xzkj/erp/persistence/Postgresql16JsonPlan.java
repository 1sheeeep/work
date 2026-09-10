package cn.xzkj.erp.persistence;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Small structural reader for PostgreSQL {@code EXPLAIN (FORMAT JSON)} output.
 *
 * <p>The gate intentionally reasons about equivalent planner nodes instead of
 * snapshotting a brittle text plan. It never enables or disables planner paths.
 */
final class Postgresql16JsonPlan {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Set<String> INDEX_NODE_TYPES =
            Set.of("Index Scan", "Index Only Scan", "Bitmap Index Scan");

    private final List<PlanNode> nodes;

    private Postgresql16JsonPlan(List<PlanNode> nodes) {
        this.nodes = List.copyOf(nodes);
    }

    static Postgresql16JsonPlan explain(
            Connection connection,
            String sql,
            Object... parameters) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement(
                        "EXPLAIN (FORMAT JSON) " + sql)) {
            for (int index = 0; index < parameters.length; index++) {
                statement.setObject(index + 1, parameters[index]);
            }
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next()) {
                    throw new SQLException("EXPLAIN returned no rows");
                }
                JsonNode root = JSON.readTree(result.getString(1))
                        .get(0)
                        .get("Plan");
                List<PlanNode> flattened = new ArrayList<>();
                flatten(root, flattened);
                return new Postgresql16JsonPlan(flattened);
            }
        }
    }

    List<PlanNode> scansOf(String relation) {
        return nodes.stream()
                .filter(node -> relation.equals(node.relationName()))
                .toList();
    }

    Set<String> indexNames() {
        return nodes.stream()
                .map(PlanNode::indexName)
                .filter(Objects::nonNull)
                .collect(Collectors.toUnmodifiableSet());
    }

    boolean usesAnyIndex(Set<String> acceptableIndexes) {
        return nodes.stream()
                .anyMatch(node -> INDEX_NODE_TYPES.contains(node.nodeType())
                        && node.indexName() != null
                        && acceptableIndexes.contains(node.indexName()));
    }

    boolean usesTenantPredicateInAnyIndex(Set<String> acceptableIndexes) {
        return nodes.stream()
                .anyMatch(node -> node.indexName() != null
                        && acceptableIndexes.contains(node.indexName())
                        && node.mentionsTenantPredicate());
    }

    List<PlanNode> nodesOfType(String type) {
        return nodes.stream()
                .filter(node -> type.equals(node.nodeType()))
                .toList();
    }

    String describe() {
        return nodes.stream()
                .map(node -> "%s[%s,%s rows=%d]".formatted(
                        node.nodeType(),
                        node.relationName(),
                        node.indexName(),
                        node.planRows()))
                .collect(Collectors.joining(" -> "));
    }

    private static void flatten(JsonNode json, List<PlanNode> flattened) {
        flattened.add(new PlanNode(
                text(json, "Node Type"),
                text(json, "Relation Name"),
                text(json, "Index Name"),
                text(json, "Index Cond"),
                text(json, "Filter"),
                json.path("Plan Rows").asLong()));
        JsonNode children = json.get("Plans");
        if (children != null) {
            for (JsonNode child : children) {
                flatten(child, flattened);
            }
        }
    }

    private static String text(JsonNode json, String field) {
        JsonNode value = json.get(field);
        return value == null || value.isNull() ? null : value.asString();
    }

    record PlanNode(
            String nodeType,
            String relationName,
            String indexName,
            String indexCondition,
            String filter,
            long planRows) {

        boolean isSequentialScan() {
            return "Seq Scan".equals(nodeType);
        }

        boolean mentionsTenantPredicate() {
            return containsTenant(indexCondition) || containsTenant(filter);
        }

        private static boolean containsTenant(String expression) {
            return expression != null && expression.contains("tenant_id");
        }
    }
}
