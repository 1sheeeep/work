package ai.xzkj.recruitment.organization;

import java.time.Instant;
import java.util.UUID;

public record GroupResponse(
        UUID id,
        String name,
        String shortName,
        String timezone,
        String description,
        long version,
        Instant updatedAt
) {
    static GroupResponse from(GroupProfile group) {
        return new GroupResponse(
                group.getId(), group.getName(), group.getShortName(), group.getTimezone(),
                group.getDescription(), group.getVersion(), group.getUpdatedAt()
        );
    }
}
