package cn.xzkj.erp.config;

public final class ProductionProfileConfigurationException
        extends RuntimeException {

    private static final String SAFE_MESSAGE =
            "Production profile configuration failed safely";

    public ProductionProfileConfigurationException() {
        super(SAFE_MESSAGE);
    }
}
