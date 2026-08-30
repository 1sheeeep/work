package ai.xzkj.recruitment.resumes;

import ai.xzkj.recruitment.common.ApiException;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.poi.openxml4j.util.ZipSecureFile;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

@Component
public class ResumeDocumentTextExtractor {
    private static final int MAX_BYTES = 8 * 1024 * 1024;
    private static final int MAX_PDF_PAGES = 30;
    private static final int MAX_ZIP_ENTRIES = 200;
    private static final int MAX_TEXT_CHARS = 30_000;

    public ExtractedResumeDocument extract(MultipartFile file) {
        if (file == null || file.isEmpty()) throw bad("RESUME_FILE_REQUIRED", "请选择 PDF 或 DOCX 简历文件");
        if (file.getSize() > MAX_BYTES) throw bad("RESUME_FILE_TOO_LARGE", "简历文件不能超过 8MB");
        try {
            byte[] bytes = file.getBytes();
            if (bytes.length == 0 || bytes.length > MAX_BYTES) throw bad("RESUME_FILE_TOO_LARGE", "简历文件不能超过 8MB");
            if (pdf(bytes)) return new ExtractedResumeDocument("PDF", extractPdf(bytes), hash(bytes));
            if (zip(bytes)) return new ExtractedResumeDocument("DOCX", extractDocx(bytes), hash(bytes));
            throw bad("RESUME_FILE_TYPE_UNSUPPORTED", "仅支持可提取文本的 PDF 或 DOCX 简历文件");
        } catch (ApiException exception) {
            throw exception;
        } catch (Exception exception) {
            throw bad("RESUME_FILE_EXTRACT_FAILED", "无法安全提取该简历文件，请改用可复制文本或其他 PDF/DOCX 文件");
        }
    }

    private String extractPdf(byte[] bytes) throws IOException {
        try (PDDocument document = Loader.loadPDF(bytes)) {
            if (document.isEncrypted()) throw bad("RESUME_FILE_ENCRYPTED", "不支持受密码保护的简历 PDF");
            if (document.getNumberOfPages() > MAX_PDF_PAGES) throw bad("RESUME_PDF_TOO_MANY_PAGES", "简历 PDF 不能超过 30 页");
            PDFTextStripper stripper = new PDFTextStripper();
            stripper.setEndPage(MAX_PDF_PAGES);
            return cleanText(stripper.getText(document));
        }
    }

    private String extractDocx(byte[] bytes) throws IOException {
        verifyDocxZip(bytes);
        ZipSecureFile.setMinInflateRatio(0.01d);
        try (XWPFDocument document = new XWPFDocument(new ByteArrayInputStream(bytes))) {
            StringBuilder text = new StringBuilder();
            document.getParagraphs().forEach(paragraph -> append(text, paragraph.getText()));
            document.getTables().forEach(table -> table.getRows().forEach(row -> row.getTableCells()
                    .forEach(cell -> append(text, cell.getText()))));
            return cleanText(text.toString());
        }
    }

    private void verifyDocxZip(byte[] bytes) throws IOException {
        boolean documentXml = false;
        int entries = 0;
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(bytes))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (++entries > MAX_ZIP_ENTRIES) throw bad("RESUME_DOCX_TOO_COMPLEX", "DOCX 文件结构过于复杂，已拒绝处理");
                String name = entry.getName();
                if (name.contains("..") || name.startsWith("/") || name.startsWith("\\")) throw bad("RESUME_DOCX_INVALID", "DOCX 文件路径不安全");
                if ("word/document.xml".equals(name)) documentXml = true;
                if ("word/vbaProject.bin".equals(name)) throw bad("RESUME_DOCX_MACRO_BLOCKED", "不接受包含宏的 Word 文件");
            }
        }
        if (!documentXml) throw bad("RESUME_FILE_TYPE_UNSUPPORTED", "文件不是有效的 DOCX 简历");
    }

    private void append(StringBuilder target, String value) {
        if (value != null && !value.isBlank()) target.append(value.trim()).append('\n');
    }

    private String cleanText(String value) {
        String clean = value == null ? "" : value.replace("\u0000", "").trim();
        if (clean.isBlank()) throw bad("RESUME_TEXT_EMPTY", "未能从该文件提取可读文本；扫描件请等待 OCR 功能接入或手工粘贴必要文本");
        if (clean.length() > MAX_TEXT_CHARS) throw bad("RESUME_TEXT_TOO_LONG", "提取文本超过 30000 字，无法安全进入单次 AI 分析");
        return clean;
    }

    private boolean pdf(byte[] bytes) { return bytes.length >= 5 && new String(bytes, 0, 5, StandardCharsets.US_ASCII).equals("%PDF-"); }
    private boolean zip(byte[] bytes) { return bytes.length >= 4 && bytes[0] == 'P' && bytes[1] == 'K' && bytes[2] == 3 && bytes[3] == 4; }
    private String hash(byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (Exception exception) { throw new IllegalStateException("SHA-256 unavailable", exception); }
    }
    private ApiException bad(String code, String message) { return new ApiException(HttpStatus.BAD_REQUEST, code, message); }

    public record ExtractedResumeDocument(String type, String text, String documentHash) {}
}
