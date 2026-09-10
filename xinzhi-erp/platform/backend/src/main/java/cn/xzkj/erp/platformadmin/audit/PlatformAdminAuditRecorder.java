package cn.xzkj.erp.platformadmin.audit;

public interface PlatformAdminAuditRecorder {

    void record(PlatformAdminAuditEvent event);

    default void recordAtomically(PlatformAdminAuditEvent event) {
        record(event);
    }
}
