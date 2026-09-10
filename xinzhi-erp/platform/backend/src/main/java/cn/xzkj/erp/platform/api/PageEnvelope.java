package cn.xzkj.erp.platform.api;

import java.util.List;
import java.util.function.Function;

import org.springframework.data.domain.Page;

public record PageEnvelope<T>(
        List<T> items,
        int page,
        int size,
        long totalElements,
        int totalPages
) {
    public static <S, T> PageEnvelope<T> from(Page<S> source, Function<S, T> mapper) {
        return new PageEnvelope<>(
                source.getContent().stream().map(mapper).toList(),
                source.getNumber(),
                source.getSize(),
                source.getTotalElements(),
                source.getTotalPages()
        );
    }
}
