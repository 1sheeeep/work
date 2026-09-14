package ai.xzkj.recruitment.resumes;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ResumeCandidateNameTest {
    @Test
    void recognizesSplitChineseNameLabels() {
        assertThat(ResumeCandidateName.recognize("姓 名：张三\n电话：13800000000")).isEqualTo("张三");
        assertThat(ResumeCandidateName.recognize("真 实 姓 名 李四\n民 族 汉族")).isEqualTo("李四");
        assertThat(ResumeCandidateName.recognize("姓名 张五\n电话 13800000000")).isEqualTo("张五");
    }

    @Test
    void recognizesHeaderWithSplitFieldsBeforeNameValue() {
        String text = "姓 名 民 族 电 话 邮 箱 住 址 易俊杰 汉族 13790244808 1210551137@qq.com";
        assertThat(ResumeCandidateName.recognize(text)).isEqualTo("易俊杰");
    }

    @Test
    void onlyVerifiesNameWhenItAppearsInResumeText() {
        assertThat(ResumeCandidateName.verified("易 俊 杰", "基本信息 易俊杰")).isEqualTo("易俊杰");
        assertThat(ResumeCandidateName.verified("张三", "基本信息 李四")).isNull();
        assertThat(ResumeCandidateName.verified("匿名候选人 c87c1ca2", "匿名候选人 c87c1ca2")).isNull();
    }
}
