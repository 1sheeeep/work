package cn.xzkj.erp.iam.bootstrap;

public class InitialAdminBootstrapException extends RuntimeException {

    private static final String SAFE_MESSAGE =
            "Initial administrator bootstrap failed safely";

    public InitialAdminBootstrapException() {
        super(SAFE_MESSAGE);
    }
}
