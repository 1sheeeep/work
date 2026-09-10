package cn.xzkj.erp.product.api;

import java.net.URI;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.product.api.ProductImageDtos.ImageResponse;
import cn.xzkj.erp.product.api.ProductImageDtos.UpdateImageRequest;
import cn.xzkj.erp.product.service.ProductActor;
import cn.xzkj.erp.product.service.ProductImageService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

@RestController
@Validated
@RequestMapping("/api/v1/product-center/spus/{spuId}/images")
public class ProductImageController {
    private static final Pattern REQUEST_ID =
            Pattern.compile("^[A-Za-z0-9._:-]{1,100}$");
    private final ProductImageService service;

    public ProductImageController(ProductImageService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('products.read')")
    public ResponseEntity<List<ImageResponse>> list(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID spuId) {
        return ResponseEntity.ok(service.list(principal.tenantId(), spuId).stream()
                .map(ImageResponse::from)
                .toList());
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAuthority('products.write')")
    public ResponseEntity<ImageResponse> upload(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID spuId,
            @RequestPart("file") MultipartFile file,
            @RequestParam(defaultValue = "0") @Min(0) @Max(32767)
                    int sortOrder,
            @RequestParam(defaultValue = "false") boolean primary,
            HttpServletRequest httpRequest) throws java.io.IOException {
        ImageResponse response = ImageResponse.from(service.upload(
                actor(principal, httpRequest),
                spuId,
                file.getInputStream(),
                file.getOriginalFilename(),
                file.getContentType(),
                sortOrder,
                primary));
        return ResponseEntity.created(URI.create(
                "/api/v1/product-center/spus/" + spuId
                + "/images/" + response.id())).body(response);
    }

    @GetMapping("/{imageId}/content")
    @PreAuthorize("hasAuthority('products.read')")
    public ResponseEntity<byte[]> content(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID spuId,
            @PathVariable UUID imageId) {
        var content = service.content(
                principal.tenantId(),
                spuId,
                imageId);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(
                        content.contentType()))
                .cacheControl(CacheControl.noStore())
                .header(HttpHeaders.PRAGMA, "no-cache")
                .header("X-Content-Type-Options", "nosniff")
                .header(HttpHeaders.CONTENT_DISPOSITION, "inline")
                .contentLength(content.bytes().length)
                .body(content.bytes());
    }

    @PutMapping("/{imageId}")
    @PreAuthorize("hasAuthority('products.write')")
    public ImageResponse update(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID spuId,
            @PathVariable UUID imageId,
            @Valid @RequestBody UpdateImageRequest request,
            HttpServletRequest httpRequest) {
        return ImageResponse.from(service.updatePresentation(
                actor(principal, httpRequest),
                spuId,
                imageId,
                request.version(),
                request.sortOrder(),
                request.primary()));
    }

    @PutMapping(
            value = "/{imageId}/content",
            consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAuthority('products.write')")
    public ImageResponse replace(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID spuId,
            @PathVariable UUID imageId,
            @RequestParam @Min(0) long version,
            @RequestPart("file") MultipartFile file,
            HttpServletRequest httpRequest) throws java.io.IOException {
        return ImageResponse.from(service.replace(
                actor(principal, httpRequest),
                spuId,
                imageId,
                version,
                file.getInputStream(),
                file.getOriginalFilename(),
                file.getContentType()));
    }

    @DeleteMapping("/{imageId}")
    @PreAuthorize("hasAuthority('products.write')")
    public ResponseEntity<Void> delete(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID spuId,
            @PathVariable UUID imageId,
            @RequestParam @Min(0) long version,
            HttpServletRequest httpRequest) {
        service.delete(
                actor(principal, httpRequest),
                spuId,
                imageId,
                version);
        return ResponseEntity.noContent().build();
    }

    private static ProductActor actor(
            ErpPrincipal principal,
            HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId != null) {
            requestId = requestId.strip();
            if (!REQUEST_ID.matcher(requestId).matches()) {
                requestId = null;
            }
        }
        return new ProductActor(
                principal.tenantId(),
                principal.userId(),
                principal.systemAdminId(),
                requestId,
                request.getRemoteAddr());
    }
}
