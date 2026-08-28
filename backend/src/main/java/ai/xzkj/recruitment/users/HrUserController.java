package ai.xzkj.recruitment.users;

import ai.xzkj.recruitment.auth.UserRole;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/hr-users")
@PreAuthorize("hasRole('SYSTEM_ADMIN')")
public class HrUserController {
    private final HrUserService service;

    public HrUserController(HrUserService service) {
        this.service = service;
    }

    @GetMapping
    public List<HrUserResponse> list(@RequestParam(required = false) String keyword,
                                     @RequestParam(required = false) UserRole role,
                                     @RequestParam(required = false) Boolean enabled) {
        return service.list(keyword, role, enabled);
    }

    @PostMapping
    public HrUserResponse create(@Valid @RequestBody HrUserCreateRequest request) {
        return service.create(request);
    }

    @PutMapping("/{id}")
    public HrUserResponse update(@PathVariable UUID id, @Valid @RequestBody HrUserUpdateRequest request) {
        return service.update(id, request);
    }

    @PatchMapping("/{id}/status")
    public HrUserResponse changeStatus(@PathVariable UUID id, @RequestBody HrUserStatusRequest request) {
        return service.changeStatus(id, request.enabled());
    }

    @PutMapping("/{id}/password")
    public void resetPassword(@PathVariable UUID id, @Valid @RequestBody HrUserPasswordRequest request) {
        service.resetPassword(id, request);
    }
}
