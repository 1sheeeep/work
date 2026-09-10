package cn.xzkj.erp.product.api;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonAnySetter;

import cn.xzkj.erp.product.domain.ProductSpuImage;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

public final class ProductImageDtos {
    private ProductImageDtos() {
    }

    public record UpdateImageRequest(
            @NotNull @Min(0) Long version,
            @Min(0) @Max(32767) int sortOrder,
            boolean primary) {
        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException(
                    "Unknown product image request field");
        }
    }

    public record ImageResponse(
            UUID id,
            UUID spuId,
            String contentType,
            long byteSize,
            int widthPixels,
            int heightPixels,
            int sortOrder,
            boolean primary,
            String createdByType,
            UUID createdBy,
            Instant createdAt,
            Instant updatedAt,
            long version) {
        static ImageResponse from(ProductSpuImage image) {
            return new ImageResponse(
                    image.getId(),
                    image.getSpuId(),
                    image.getContentType(),
                    image.getByteSize(),
                    image.getPixelWidth(),
                    image.getPixelHeight(),
                    image.getSortOrder(),
                    image.isPrimaryImage(),
                    image.getCreatedByType(),
                    image.getCreatedBy(),
                    image.getCreatedAt(),
                    image.getUpdatedAt(),
                    image.getVersion());
        }
    }
}
