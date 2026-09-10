package cn.xzkj.erp.iam.application;

import java.util.List;

public record PageResult<T>(
        List<T> items,
        int page,
        int size,
        long totalElements,
        long totalPages) {

    public PageResult {
        items = List.copyOf(items);
    }

    public static <T> PageResult<T> of(
            List<T> items,
            int page,
            int size,
            long totalElements) {
        long totalPages = totalElements == 0
                ? 0
                : ((totalElements - 1) / size) + 1;
        return new PageResult<>(items, page, size, totalElements, totalPages);
    }
}
