package ai.xzkj.recruitment.boss;

import org.springframework.stereotype.Component;

@Component
public class LocalConnectorMessageGateway implements BossGateway {
    @Override
    public MessageSendResult sendMessage(BossAccount account, MessageSendRequest request) {
        return new MessageSendResult(false, "本地连接器尚未通过真实页面发送验收，消息保留待 HR 处理");
    }
}
