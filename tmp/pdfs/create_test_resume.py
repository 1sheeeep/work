from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

OUTPUT = "output/pdf/test-resume-lin-jiaming.pdf"

pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))

doc = SimpleDocTemplate(
    OUTPUT,
    pagesize=A4,
    rightMargin=22 * mm,
    leftMargin=22 * mm,
    topMargin=18 * mm,
    bottomMargin=18 * mm,
    title="外部 PDF 简历分析测试 - 林嘉明",
    author="Recruitment Console Test Fixture",
)

base = ParagraphStyle(
    "base", fontName="STSong-Light", fontSize=10.5, leading=17,
    textColor=colors.HexColor("#344054"), alignment=TA_LEFT,
)
title = ParagraphStyle(
    "title", parent=base, fontSize=24, leading=30,
    textColor=colors.HexColor("#172033"), spaceAfter=4,
)
subtitle = ParagraphStyle(
    "subtitle", parent=base, fontSize=10, leading=15,
    textColor=colors.HexColor("#667085"), spaceAfter=12,
)
section = ParagraphStyle(
    "section", parent=base, fontSize=12.5, leading=18,
    textColor=colors.HexColor("#0F766E"), spaceBefore=9, spaceAfter=5,
)
small = ParagraphStyle(
    "small", parent=base, fontSize=9, leading=14,
    textColor=colors.HexColor("#667085"),
)

story = []
banner = Table([[Paragraph("虚构测试数据 - 仅用于验证 PDF 解析和岗位匹配", small)]], colWidths=[166 * mm])
banner.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#ECFDF5")),
    ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#A7F3D0")),
    ("LEFTPADDING", (0, 0), (-1, -1), 9),
    ("RIGHTPADDING", (0, 0), (-1, -1), 9),
    ("TOPPADDING", (0, 0), (-1, -1), 7),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
]))
story.extend([banner, Spacer(1, 8 * mm)])
story.append(Paragraph("林嘉明", title))
story.append(Paragraph("Node.js 全栈开发工程师 | 5 年工作经验 | 本科", subtitle))

story.append(Paragraph("个人概述", section))
story.append(Paragraph(
    "5 年 Web 全栈开发经验，长期使用 Node.js、TypeScript、Vue 3 和 Python。"
    "能独立负责后端 API、前端工作台、PostgreSQL 数据库及 Docker 部署，"
    "有招聘 SaaS 与业务自动化项目经验。", base))

story.append(Paragraph("核心技能", section))
skills = [
    ["Node.js / TypeScript", "熟练，使用 NestJS 和 Express 开发 REST API"],
    ["Vue 3", "熟练 Composition API、TypeScript、Element Plus"],
    ["Python", "用于文档处理、数据清洗和 AI 服务集成"],
    ["PostgreSQL / Redis", "数据建模、索引优化、缓存与幂等处理"],
    ["Docker / CI", "容器化部署、健康检查、自动构建与测试"],
]
table = Table([[Paragraph(f"<b>{k}</b>", base), Paragraph(v, base)] for k, v in skills], colWidths=[45 * mm, 121 * mm])
table.setStyle(TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LINEBELOW", (0, 0), (-1, -2), 0.35, colors.HexColor("#EAECF0")),
    ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ("TOPPADDING", (0, 0), (-1, -1), 5),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
]))
story.append(table)

story.append(Paragraph("工作经历", section))
story.append(Paragraph("<b>某企业服务科技公司 | 高级全栈工程师 | 2023 - 至今</b>", base))
story.append(Paragraph(
    "- 使用 Node.js、TypeScript 和 PostgreSQL 设计多租户业务 API；<br/>"
    "- 基于 Vue 3 开发内部运营工作台，补齐 loading、empty 和 error 状态；<br/>"
    "- 建立 Docker Compose 本地环境和自动化测试流程，降低部署故障率；<br/>"
    "- 接入结构化 AI 分析服务，实施请求去重、审计和失败重试。", base))
story.append(Spacer(1, 3 * mm))
story.append(Paragraph("<b>某电商技术团队 | Node.js 开发工程师 | 2021 - 2023</b>", base))
story.append(Paragraph(
    "- 开发订单、库存和报表服务，实现异步任务与监控告警；<br/>"
    "- 优化数据库查询和接口响应时间，参与代码评审与故障复盘。", base))

story.append(Paragraph("项目经历", section))
story.append(Paragraph(
    "<b>招聘运营自动化工作台</b><br/>"
    "负责候选人消息队列、简历文本提取、AI 辅助分析和 HR 复核界面。"
    "使用 Vue 3、Node.js、Python、PostgreSQL 和 Docker，关注权限隔离、隐私和审计可追溯性。", base))

story.append(Paragraph("教育背景", section))
story.append(Paragraph("某大学 | 计算机科学与技术 | 本科 | 2017 - 2021", base))
story.append(Spacer(1, 8 * mm))
story.append(Paragraph("本文档中的姓名、公司、学校和经历均为虚构，仅用于功能测试。", small))

doc.build(story)
