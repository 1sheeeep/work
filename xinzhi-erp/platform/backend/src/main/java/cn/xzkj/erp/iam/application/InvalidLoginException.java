package cn.xzkj.erp.iam.application;

public class InvalidLoginException extends RuntimeException {

    public InvalidLoginException() {
        super("Invalid tenant, username, or password");
    }
}
