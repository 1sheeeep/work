package ai.xzkj.recruitment.candidates;

import ai.xzkj.recruitment.common.ApiException;
import org.apache.commons.csv.CSVFormat;
import org.apache.poi.ss.usermodel.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

@Component
public class CandidateImportParser {
    private static final int MAX_ROWS=1000;
    public ParsedFile parse(MultipartFile file){
        String name=Optional.ofNullable(file.getOriginalFilename()).orElse("candidates.csv");
        String lower=name.toLowerCase(Locale.ROOT);
        try{
            if(lower.endsWith(".csv"))return new ParsedFile("CSV",parseCsv(file));
            if(lower.endsWith(".xlsx"))return new ParsedFile("XLSX",parseXlsx(file));
            throw new ApiException(HttpStatus.BAD_REQUEST,"IMPORT_FORMAT_UNSUPPORTED","仅支持 UTF-8 CSV 或 XLSX 文件");
        }catch(ApiException e){throw e;}catch(Exception e){throw new ApiException(HttpStatus.BAD_REQUEST,"IMPORT_FILE_INVALID","文件无法解析，请检查格式和表头");}
    }
    private List<ParsedRow> parseCsv(MultipartFile file)throws IOException{
        try(var reader=new InputStreamReader(file.getInputStream(),StandardCharsets.UTF_8);var parser=CSVFormat.DEFAULT.builder().setHeader().setSkipHeaderRecord(true).setIgnoreEmptyLines(true).setTrim(true).get().parse(reader)){
            Map<String,String> headers=headers(parser.getHeaderNames());List<ParsedRow> rows=new ArrayList<>();
            for(var record:parser){if(rows.size()>=MAX_ROWS)throw tooMany();Map<String,String> values=new HashMap<>();headers.forEach((canonical,actual)->values.put(canonical,record.isMapped(actual)?record.get(actual):""));rows.add(new ParsedRow(Math.toIntExact(record.getRecordNumber()+1),values));}
            return rows;
        }
    }
    private List<ParsedRow> parseXlsx(MultipartFile file)throws IOException{
        try(var workbook=WorkbookFactory.create(file.getInputStream())){
            if(workbook.getNumberOfSheets()<1)throw new ApiException(HttpStatus.BAD_REQUEST,"IMPORT_FILE_EMPTY","工作簿没有工作表");
            Sheet sheet=workbook.getSheetAt(0);Row headerRow=sheet.getRow(sheet.getFirstRowNum());if(headerRow==null)throw new ApiException(HttpStatus.BAD_REQUEST,"IMPORT_HEADER_MISSING","缺少表头");
            DataFormatter formatter=new DataFormatter(Locale.ROOT);Map<String,Integer> headers=headers(headerRow,formatter);List<ParsedRow> rows=new ArrayList<>();
            for(int index=headerRow.getRowNum()+1;index<=sheet.getLastRowNum();index++){Row row=sheet.getRow(index);if(row==null||blank(row,formatter))continue;if(rows.size()>=MAX_ROWS)throw tooMany();Map<String,String> values=new HashMap<>();headers.forEach((canonical,column)->values.put(canonical,cell(row.getCell(column),formatter)));rows.add(new ParsedRow(index+1,values));}
            return rows;
        }
    }
    private Map<String,String> headers(List<String> names){Map<String,String> result=new HashMap<>();for(String name:names){String canonical=canonical(name);if(canonical!=null)result.putIfAbsent(canonical,name);}requireHeaders(result.keySet());return result;}
    private Map<String,Integer> headers(Row row,DataFormatter formatter){Map<String,Integer> result=new HashMap<>();for(Cell cell:row){String canonical=canonical(formatter.formatCellValue(cell));if(canonical!=null)result.putIfAbsent(canonical,cell.getColumnIndex());}requireHeaders(result.keySet());return result;}
    private String canonical(String raw){String value=raw==null?"":raw.replace("\uFEFF","").replaceAll("[\\s_]","").toLowerCase(Locale.ROOT);return switch(value){case "externalcandidateid","外部候选人id","候选人id"->"externalCandidateId";case "displayname","姓名","候选人姓名"->"displayName";case "currenttitle","当前职位"->"currentTitle";case "yearsexperience","工作年限"->"yearsExperience";case "education","学历"->"education";case "skillssummary","技能摘要","技能"->"skillsSummary";default->null;};}
    private void requireHeaders(Set<String> headers){if(!headers.contains("externalCandidateId")||!headers.contains("displayName"))throw new ApiException(HttpStatus.BAD_REQUEST,"IMPORT_HEADER_INVALID","表头必须包含 externalCandidateId/外部候选人ID 和 displayName/姓名");}
    private boolean blank(Row row,DataFormatter formatter){for(Cell cell:row)if(!cell(cell,formatter).isBlank())return false;return true;}
    private String cell(Cell cell,DataFormatter formatter){if(cell==null)return "";if(cell.getCellType()==CellType.FORMULA)return "=FORMULA_UNSUPPORTED";return formatter.formatCellValue(cell).trim();}
    private ApiException tooMany(){return new ApiException(HttpStatus.BAD_REQUEST,"IMPORT_ROW_LIMIT_EXCEEDED","单次最多导入 1000 行");}
    public record ParsedFile(String format,List<ParsedRow> rows){}
    public record ParsedRow(int rowNumber,Map<String,String> values){public String value(String key){return values.getOrDefault(key,"").trim();}}
}
