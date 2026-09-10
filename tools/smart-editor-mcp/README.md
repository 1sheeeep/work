# smart-editor-mcp

为复杂代码文件提供带行号读取和按行范围替换，避免整文件 `write_file` 造成的 JSON 解析失败。

## 安装与启动

```bash
npm install
ALLOWED_ROOT="/Users/jiahao" npm start
```

`replace_by_line_range` 必须传入 `confirm: "CONFIRM_WRITE"`，以配合智能体的“先展示 diff、再确认执行”规则。
