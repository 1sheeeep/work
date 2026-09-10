package cn.xzkj.erp.iam.entry;

public class FirstPartyApplicationEntryException extends RuntimeException {

    private FirstPartyApplicationEntryException(String code) {
        super(code);
    }

    public static FirstPartyApplicationEntryException unavailable() {
        return new FirstPartyApplicationEntryException("unavailable");
    }

    public static FirstPartyApplicationEntryException invalidTarget() {
        return new FirstPartyApplicationEntryException("invalid_target");
    }

    public static FirstPartyApplicationEntryException invalidGrant() {
        return new FirstPartyApplicationEntryException("invalid_grant");
    }
}
