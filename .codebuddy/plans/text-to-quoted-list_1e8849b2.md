---
name: text-to-quoted-list
overview: 实现一个 Tampermonkey 用户脚本：提供右下角浮层面板，把多分隔符文本转为单/双引号列表，并支持一键复制。
design:
  architecture:
    framework: html
  styleKeywords:
    - Glassmorphism
    - Premium Floating Panel
    - High Contrast Actions
    - Micro-interactions
  fontSystem:
    fontFamily: PingFang SC
    heading:
      size: 14px
      weight: 600
    subheading:
      size: 12px
      weight: 500
    body:
      size: 12px
      weight: 400
  colorSystem:
    primary:
      - "#4F46E5"
      - "#7C3AED"
      - "#06B6D4"
    background:
      - "#0B1220"
      - "#111827"
      - "#FFFFFF"
    text:
      - "#E5E7EB"
      - "#0F172A"
    functional:
      - "#22C55E"
      - "#F59E0B"
      - "#EF4444"
todos:
  - id: userscript-metadata
    content: 编写油猴脚本头与注入时机
    status: completed
  - id: floating-panel-ui
    content: 实现右下角浮层面板与收起关闭
    status: completed
    dependencies:
      - userscript-metadata
  - id: token-parse-clean
    content: 实现多分隔符拆分、去空白、保序
    status: completed
    dependencies:
      - floating-panel-ui
  - id: quote-escape-format
    content: 实现单/双引号输出与自动转义
    status: completed
    dependencies:
      - token-parse-clean
  - id: copy-actions-feedback
    content: 实现两路一键复制与提示反馈
    status: completed
    dependencies:
      - quote-escape-format
  - id: persistence-options
    content: 加入记忆输入与常用开关（可选）
    status: completed
    dependencies:
      - copy-actions-feedback
  - id: readme-examples
    content: 补充 README 安装使用与示例
    status: completed
    dependencies:
      - copy-actions-feedback
---

## Product Overview

一个 Tampermonkey 用户脚本，在任意网页右下角显示浮层面板，将“多分隔符文本”转换为带引号的列表，并支持一键复制。

## Core Features

- 右下角浮层面板：可展开/收起，不遮挡页面主要内容，始终悬浮显示
- 多分隔符解析：支持逗号、分号、空格、换行、Tab 等混合分隔的文本输入
- 两种输出格式：同时生成单引号列表与双引号列表，清晰分区展示
- 清洗与保序：自动去掉空白项、保留原始顺序，输出结果可直接用于粘贴
- 自动转义：对引号进行安全转义（单引号按 SQL 规则使用 ''），避免复制后语法错误
- 一键复制：分别复制单引号结果/双引号结果，复制成功给出轻提示

## Tech Stack

- 交付形态：Tampermonkey/油猴 UserScript（单文件 .user.js）
- 脚本语言：JavaScript（ES2020+）
- UI：原生 DOM + CSS（Shadow DOM 可选用于样式隔离）
- 复制能力：Clipboard API（优先）+ `document.execCommand('copy')` 回退
- 存储：GM_setValue/GM_getValue（记忆上次输入与配置，可选）

## Tech Architecture

### Data Flow

```mermaid
flowchart LR
  A[用户输入多分隔符文本] --> B[解析/拆分 tokens]
  B --> C[清洗: trim/去空/保序]
  C --> D1[生成单引号列表并转义 SQL 单引号]
  C --> D2[生成双引号列表并转义双引号/反斜杠]
  D1 --> E1[输出区: 单引号结果]
  D2 --> E2[输出区: 双引号结果]
  E1 --> F1[一键复制(单引号)]
  E2 --> F2[一键复制(双引号)]
```

## Implementation Details

### Core Directory Structure

```text
text-to-quoted-list/
├── text-to-quoted-list.user.js   # 主脚本：UI 注入、解析、格式化、复制
└── README.md                     # 安装/使用说明与示例输入输出
```

### Key Code Structures（建议）

- 配置与常量
- `DEFAULT_SEPARATORS`: 预设分隔符规则（逗号/分号/空白/换行/Tab）
- `UI_IDS`: 统一管理 DOM id/class，避免与页面冲突
- 核心函数签名
- `parseTokens(input: string): string[]`：按多分隔符拆分并清洗
- `escapeSqlSingleQuote(s: string): string`：将 `'` 转为 `''`
- `escapeDoubleQuote(s: string): string`：处理 `"` 与必要的反斜杠
- `formatQuotedList(tokens: string[], quote: "'" | '"'): string`：生成 `'a','b'` 或 `"a","b"`
- `copyToClipboard(text: string): Promise<boolean>`：复制并返回成功状态

## Design Style

采用高质感轻量浮层（半透明 + 模糊背景 + 细描边阴影），右下角悬浮不干扰原页面；强调“输入-转换-复制”的直线流程，按钮与输出区域具备明确层级与即时反馈。

## Screen / Block Plan（单浮层）

1. 顶栏区：标题“Text → Quoted List”，包含收起/关闭按钮与状态提示位  
2. 输入区：多行文本框，支持粘贴；提供“清空”与“示例”快捷入口  
3. 操作区：主按钮“转换”，可选开关（去空白/保序/分隔符说明）  
4. 输出区（双栏或上下分区）：单引号结果、双引号结果，各自带复制按钮  
5. 反馈区：复制成功/失败的轻提示（toast），2 秒自动消失