package cn.xzkj.erp.iam.roles;

import cn.xzkj.erp.iam.persistence.IamAssignmentStore;
import cn.xzkj.erp.iam.persistence.PermissionEntity;
import cn.xzkj.erp.iam.persistence.PermissionRepository;
import cn.xzkj.erp.iam.persistence.RoleEntity;
import cn.xzkj.erp.iam.persistence.RoleRepository;
import cn.xzkj.erp.iam.persistence.TenantEntity;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

@Service
public class PresetRoleProvisioningService {

    private final RoleRepository roleRepository;
    private final PermissionRepository permissionRepository;
    private final IamAssignmentStore assignmentStore;

    public PresetRoleProvisioningService(
            RoleRepository roleRepository,
            PermissionRepository permissionRepository,
            IamAssignmentStore assignmentStore) {
        this.roleRepository = roleRepository;
        this.permissionRepository = permissionRepository;
        this.assignmentStore = assignmentStore;
    }

    public void provision(TenantEntity tenant, Instant now) {
        Map<String, PermissionEntity> permissions = permissionRepository
                .findAllByCodeIn(PresetRoleCatalog.permissionCodes())
                .stream()
                .collect(Collectors.toUnmodifiableMap(
                        PermissionEntity::getCode,
                        Function.identity()));
        if (!permissions.keySet().containsAll(
                PresetRoleCatalog.permissionCodes())) {
            throw new IllegalStateException(
                    "Preset role permission catalog is incomplete");
        }
        for (PresetRoleCatalog.Definition definition
                : PresetRoleCatalog.DEFINITIONS) {
            RoleEntity role = roleRepository
                    .findByTenant_IdAndCode(tenant.getId(), definition.code())
                    .map(existing -> requirePresetRole(existing, definition, now))
                    .orElseGet(() -> roleRepository.saveAndFlush(
                            RoleEntity.presetRole(
                                    UUID.randomUUID(),
                                    tenant,
                                    definition.code(),
                                    definition.name(),
                                    definition.description(),
                                    now)));
            Set<UUID> permissionIds = definition.permissionCodes().stream()
                    .map(permissions::get)
                    .map(PermissionEntity::getId)
                    .collect(Collectors.toCollection(LinkedHashSet::new));
            assignmentStore.replaceRolePermissions(
                    tenant.getId(),
                    role.getId(),
                    permissionIds);
        }
    }

    private RoleEntity requirePresetRole(
            RoleEntity role,
            PresetRoleCatalog.Definition definition,
            Instant now) {
        if (role.isSystemRole() || !role.isPresetRole()) {
            throw new IllegalStateException(
                    "Preset role code conflicts with an unmanaged role: "
                            + definition.code());
        }
        if (!role.getName().equals(definition.name())
                || !Objects.equals(role.getDescription(), definition.description())) {
            role.update(definition.name(), definition.description(), now);
            return roleRepository.saveAndFlush(role);
        }
        return role;
    }
}
