package cn.xzkj.erp.customer.service;

public class CustomerServiceEntryException extends RuntimeException {

    protected CustomerServiceEntryException(String code) {
        super(code);
    }

    public static CustomerServiceEntryException unavailable() {
        return new CustomerServiceEntryUnavailableException();
    }

    public static CustomerServiceEntryException invalidGrant() {
        return new CustomerServiceEntryInvalidGrantException();
    }

    public static CustomerServiceEntryException invalidTarget() {
        return new CustomerServiceEntryInvalidTargetException();
    }
}

final class CustomerServiceEntryUnavailableException extends CustomerServiceEntryException {
    CustomerServiceEntryUnavailableException() {
        super("unavailable");
    }
}

final class CustomerServiceEntryInvalidGrantException extends CustomerServiceEntryException {
    CustomerServiceEntryInvalidGrantException() {
        super("invalid_grant");
    }
}

final class CustomerServiceEntryInvalidTargetException extends CustomerServiceEntryException {
    CustomerServiceEntryInvalidTargetException() {
        super("invalid_target");
    }
}
