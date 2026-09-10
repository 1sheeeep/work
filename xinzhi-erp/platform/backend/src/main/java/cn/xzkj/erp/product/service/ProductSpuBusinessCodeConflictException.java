package cn.xzkj.erp.product.service;

import cn.xzkj.erp.platform.service.ConflictException;

public class ProductSpuBusinessCodeConflictException
        extends ConflictException {

    public ProductSpuBusinessCodeConflictException() {
        super("SPU business code already exists");
    }
}
