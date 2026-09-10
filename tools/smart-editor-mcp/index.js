#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const allowedRoot = path.resolve(process.env.ALLOWED_ROOT || process.cwd());
const server = new Server({ name: 'smart-editor-mcp', version: '1.0.0' }, { capabilities: { tools: {} } });

function safePath(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('file_path 必须是绝对路径。');
  const resolved = path.resolve(filePath);
  if (resolved !== allowedRoot && !resolved.startsWith(`${allowedRoot}${path.sep}`)) {
    throw new Error(`路径超出允许范围：${allowedRoot}`);
  }
  return resolved;
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  { name: 'read_file_with_lines', description: '只读读取文本文件，并给每行附加行号。', inputSchema: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'], additionalProperties: false } },
  { name: 'replace_by_line_range', description: '按行号替换文本。必须传 confirm="CONFIRM_WRITE"；不会自动扩大范围。', inputSchema: { type: 'object', properties: { file_path: { type: 'string' }, start_line: { type: 'integer', minimum: 1 }, end_line: { type: 'integer', minimum: 1 }, new_content: { type: 'string', maxLength: 100000 }, confirm: { type: 'string', enum: ['CONFIRM_WRITE'] } }, required: ['file_path', 'start_line', 'end_line', 'new_content', 'confirm'], additionalProperties: false } }
] }));

server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    const args = params.arguments || {};
    const filePath = safePath(args.file_path);
    if (params.name === 'read_file_with_lines') {
      const text = await fs.readFile(filePath, 'utf8');
      return { content: [{ type: 'text', text: text.split('\n').map((line, i) => `${i + 1} | ${line}`).join('\n') }] };
    }
    if (params.name === 'replace_by_line_range') {
      if (args.confirm !== 'CONFIRM_WRITE') throw new Error('缺少明确确认：必须传 confirm="CONFIRM_WRITE"。');
      const text = await fs.readFile(filePath, 'utf8');
      const lines = text.split('\n');
      if (!Number.isInteger(args.start_line) || !Number.isInteger(args.end_line) || args.start_line < 1 || args.end_line < args.start_line || args.end_line > lines.length) throw new Error(`行号无效，文件共 ${lines.length} 行。`);
      lines.splice(args.start_line - 1, args.end_line - args.start_line + 1, ...String(args.new_content).split('\n'));
      await fs.writeFile(filePath, lines.join('\n'), 'utf8');
      return { content: [{ type: 'text', text: `已修改 ${filePath} 第 ${args.start_line}-${args.end_line} 行。` }] };
    }
    throw new Error(`未知工具：${params.name}`);
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: `执行失败：${error instanceof Error ? error.message : String(error)}` }] };
  }
});

await server.connect(new StdioServerTransport());
console.error(`smart-editor-mcp 已启动，允许根目录：${allowedRoot}`);
