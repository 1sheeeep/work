package cn.xzkj.erp.platform.domain;

public enum AuthorizationStatus {
    NOT_REQUIRED,
    NOT_AUTHORIZED,
    PENDING,
    AUTHORIZED,
    EXPIRED,
    REVOKED,
    ERROR
}
