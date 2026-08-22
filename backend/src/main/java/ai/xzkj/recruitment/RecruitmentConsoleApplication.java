package ai.xzkj.recruitment;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class RecruitmentConsoleApplication {

	public static void main(String[] args) {
		SpringApplication.run(RecruitmentConsoleApplication.class, args);
	}

}
