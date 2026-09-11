package ai.xzkj.recruitment.localconnector;

import java.util.UUID;

/** 供后台慢任务判断某个账号的入站回复队列是否仍有优先工作。 */
public interface InboundReplyWorkGate {
    boolean hasPendingWork(UUID accountId);
}
