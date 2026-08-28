package ai.xzkj.recruitment.candidates;

import ai.xzkj.recruitment.common.ApiException;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.*;

class CandidateImportParserTest {
    private final CandidateImportParser parser=new CandidateImportParser();

    @Test void parsesQuotedUtf8CsvWithChineseHeaders(){
        String csv="外部候选人ID,姓名,技能摘要\nexternal-1,张三,\"Java,Spring Boot\"\n";
        var result=parser.parse(new MockMultipartFile("file","candidates.csv","text/csv",csv.getBytes(StandardCharsets.UTF_8)));
        assertThat(result.format()).isEqualTo("CSV");assertThat(result.rows()).hasSize(1);assertThat(result.rows().getFirst().value("displayName")).isEqualTo("张三");assertThat(result.rows().getFirst().value("skillsSummary")).isEqualTo("Java,Spring Boot");
    }

    @Test void parsesXlsxAndMarksFormulaCellsAsUnsupported() throws Exception{
        byte[] bytes;try(var workbook=new XSSFWorkbook();var output=new ByteArrayOutputStream()){var sheet=workbook.createSheet();var header=sheet.createRow(0);header.createCell(0).setCellValue("externalCandidateId");header.createCell(1).setCellValue("displayName");var row=sheet.createRow(1);row.createCell(0).setCellValue("external-1");row.createCell(1).setCellFormula("1+1");workbook.write(output);bytes=output.toByteArray();}
        var result=parser.parse(new MockMultipartFile("file","candidates.xlsx","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",bytes));
        assertThat(result.rows().getFirst().value("displayName")).isEqualTo("=FORMULA_UNSUPPORTED");
    }

    @Test void rejectsFilesWithoutRequiredHeaders(){
        var file=new MockMultipartFile("file","bad.csv","text/csv","name,title\nA,B\n".getBytes(StandardCharsets.UTF_8));
        assertThatThrownBy(()->parser.parse(file)).isInstanceOf(ApiException.class).hasMessageContaining("表头必须包含");
    }
}
