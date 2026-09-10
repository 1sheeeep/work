package cn.xzkj.erp.supplier.domain;

import java.util.UUID;

import cn.xzkj.erp.platform.domain.TenantOwnedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;

@Entity
@Table(name = "tenant_suppliers")
public class Supplier extends TenantOwnedEntity {

    @Column(name = "business_code", nullable = false, length = 64)
    private String businessCode;

    @Column(nullable = false, length = 200)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 24)
    private SupplierStatus status;

    @Column(name = "contact_name", length = 120)
    private String contactName;

    @Column(name = "contact_phone", length = 40)
    private String contactPhone;

    @Column(name = "contact_email", length = 254)
    private String contactEmail;

    @Column(length = 500)
    private String address;

    @Column(name = "tax_registration_number", length = 120)
    private String taxRegistrationNumber;

    @Column(name = "settlement_currency", length = 3)
    private String settlementCurrency;

    @Column(name = "payment_terms_days")
    private Integer paymentTermsDays;

    @Column(length = 2000)
    private String notes;

    protected Supplier() {
    }

    public Supplier(
            UUID tenantId,
            String businessCode,
            String name,
            String contactName,
            String contactPhone,
            String contactEmail,
            String address,
            String taxRegistrationNumber,
            String settlementCurrency,
            Integer paymentTermsDays,
            String notes) {
        super(tenantId);
        this.businessCode = businessCode;
        this.name = name;
        this.status = SupplierStatus.ACTIVE;
        this.contactName = contactName;
        this.contactPhone = contactPhone;
        this.contactEmail = contactEmail;
        this.address = address;
        this.taxRegistrationNumber = taxRegistrationNumber;
        this.settlementCurrency = settlementCurrency;
        this.paymentTermsDays = paymentTermsDays;
        this.notes = notes;
    }

    public void update(
            String businessCode,
            String name,
            SupplierStatus status,
            String contactName,
            String contactPhone,
            String contactEmail,
            String address,
            String taxRegistrationNumber,
            String settlementCurrency,
            Integer paymentTermsDays,
            String notes) {
        this.businessCode = businessCode;
        this.name = name;
        this.status = status;
        this.contactName = contactName;
        this.contactPhone = contactPhone;
        this.contactEmail = contactEmail;
        this.address = address;
        this.taxRegistrationNumber = taxRegistrationNumber;
        this.settlementCurrency = settlementCurrency;
        this.paymentTermsDays = paymentTermsDays;
        this.notes = notes;
    }

    public String getBusinessCode() {
        return businessCode;
    }

    public String getName() {
        return name;
    }

    public SupplierStatus getStatus() {
        return status;
    }

    public String getContactName() {
        return contactName;
    }

    public String getContactPhone() {
        return contactPhone;
    }

    public String getContactEmail() {
        return contactEmail;
    }

    public String getAddress() {
        return address;
    }

    public String getTaxRegistrationNumber() {
        return taxRegistrationNumber;
    }

    public String getSettlementCurrency() {
        return settlementCurrency;
    }

    public Integer getPaymentTermsDays() {
        return paymentTermsDays;
    }

    public String getNotes() {
        return notes;
    }
}
