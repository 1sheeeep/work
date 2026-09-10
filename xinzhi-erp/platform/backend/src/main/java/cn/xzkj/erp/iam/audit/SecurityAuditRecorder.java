package cn.xzkj.erp.iam.audit;

/**
 * IAM audit port. Implementations must persist append-only records and must
 * never place passwords, raw session tokens, or credential hashes in details.
 */
public interface SecurityAuditRecorder {

    void record(SecurityAuditEvent event);

    /**
     * Records within the caller's transaction when a state mutation and its
     * audit record must commit or roll back together.
     */
    default void recordAtomically(SecurityAuditEvent event) {
        record(event);
    }
}
