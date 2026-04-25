# Markdown 源码高亮方案设计文档

> 基于 Codex Trace Viewer 现有设计系统的 Markdown 源码高亮方案
>
> 当前实现不是 Markdown 渲染器，而是保留原始文本、仅对 Markdown 语法符号和相关内容做语义化着色。

## 目录

- [目标与范围](#目标与范围)
- [当前设计系统分析](#当前设计系统分析)
- [已落地实现](#已落地实现)
- [语法高亮规则](#语法高亮规则)
- [集成方式](#集成方式)
- [限制与后续优化](#限制与后续优化)

---

## 目标与范围

本方案服务于 `Formatted Content` 面板中的 Markdown 内容展示，目标是：

- 保留原始 Markdown 文本，不把 `#`、`-`、`[link]()`、``` ``` 这类语法转换成 HTML 结构
- 用现有设计系统的语义色，为 Markdown 专有格式提供可读性更高的高亮区分
- 让用户在查看 trace 时，既能看见原始内容结构，也能快速识别语法层级

适用场景：

- message / reasoning / context / system 中出现 Markdown 源码
- 调试 prompt、system instruction、context 片段时，需要保留原始格式

不在本方案范围内：

- 富文本编辑
- 真正的 Markdown AST 渲染
- HTML 白名单渲染

---

## 当前设计系统分析

### 实际色板

以下颜色基于当前项目主题定义：

```css
/* 字体 */
--font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
--font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;

/* 背景层级 */
--color-bg-deep: #0A0A0C;
--color-bg-base: #0F0F11;
--color-bg-surface: #141416;
--color-bg-elevated: #1A1A1D;

/* 边框 */
--color-border-subtle: #2A2A2E;
--color-border-strong: #3A3A3E;

/* 品牌色 */
--color-brand-orange: #F27D26;
--color-brand-blue: #3B82F6;

/* 文本 */
--color-text-primary: #E0E0E0;
--color-text-secondary: #888888;
--color-text-muted: #555555;
--color-text-bright: #FFFFFF;
```

### 语义色映射

| 语义 | 颜色 | 用途 |
|------|------|------|
| Accent | `brand-orange` | Markdown 主语法标记、标题井号、无序列表、围栏 |
| Primary | `brand-blue` | 链接、脚注引用、有序列表编号 |
| Success | `emerald-400/500` | 代码围栏语言名、inline code、已勾选 task marker |
| Warning | `amber-400` | 引用块标记 |
| Info | `sky-300/400` | 三层标题、链接 URL |
| Neutral | `text-secondary` / `text-muted` | 空格、括号、表格分隔符、弱化文本 |
| Reasoning | `purple-300/400` | 粗体/斜体/强调语法标记 |

---

## 已落地实现

当前实现位于：

- [src/components/MarkdownRenderer.tsx](/Users/chenqh114/uni-app-projects/codex-trace-viewer/src/components/MarkdownRenderer.tsx:1)
- [src/App.tsx](/Users/chenqh114/uni-app-projects/codex-trace-viewer/src/App.tsx:1838)

### 行为概述

1. 先通过 `detectMarkdown(content)` 判断文本是否像 Markdown
2. 若命中，则进入 `MarkdownRenderer`
3. `MarkdownRenderer` 按行扫描文本，保留原始换行和字符
4. 对每一行应用特定规则，只给 Markdown 语法本身和相邻文本附加样式
5. 未命中的内容仍走原来的纯文本显示路径

### 设计取舍

- 使用 `font-mono`
  因为这是源码视图，不是排版阅读视图；保留对齐和符号位置比正文阅读舒适度更重要。
- 不引入 `react-markdown` / `remark-gfm` / `rehype-*`
  因为需求已经明确为“不要渲染，只区分 Markdown 专有格式”。
- task list 保留为 `[ ]` / `[x]`
  只做颜色强化，不替换成真正复选框。

---

## 语法高亮规则

### 1. 标题

保留 `#` 语法，分别给“标记符号”和“标题文字”不同颜色：

```md
# H1
## H2
### H3
```

对应规则：

- `#` 标记：`text-brand-orange font-semibold`
- H1 文本：`text-orange-200 font-semibold`
- H2 文本：`text-blue-200 font-semibold`
- H3 文本：`text-sky-300 font-semibold`
- H4-H6 文本：逐级回落到 `text-bright` / `text-primary` / `text-secondary`

### 2. 列表

#### 无序列表

```md
- item
* item
+ item
```

- 列表标记：`text-brand-orange`
- 分隔空格：`text-text-secondary`
- 内容：`text-text-primary`

#### 有序列表

```md
1. item
2. item
```

- 编号：`text-brand-blue font-semibold`
- 分隔空格：`text-text-secondary`

### 3. 任务列表

```md
- [x] done
- [ ] pending
```

- `-`：`text-brand-orange`
- `[` `]`：`text-text-secondary`
- `x`：`text-emerald-400`
- 未勾选空格：`text-text-muted`
- 已完成文本：`text-text-muted line-through opacity-70`

### 4. 引用

```md
> quote
>> nested quote
```

- `>` 标记：`text-amber-400`
- 引用内容：`text-amber-100/90 italic`

### 5. 代码

#### 内联代码

```md
Run `npm run build`
```

- 反引号：`text-emerald-500`
- 代码内容：`bg-black/40 border border-emerald-500/20 text-emerald-300`

#### 代码围栏

```md
```ts
const x = 1
```
```

- 围栏符号：`text-brand-orange font-semibold`
- 语言名：`text-emerald-400`
- 围栏内部内容：统一 `text-emerald-200/90`

注意：当前不会对围栏内部再做二级语言 token 高亮，只统一成代码区语义色。

### 6. 链接与图片

```md
[OpenAI](https://openai.com)
![alt](image.png)
```

- `[` `]`：`text-brand-blue`
- 链接文字：`text-brand-blue font-medium`
- `(` `)`：`text-text-secondary`
- URL：`text-sky-300`
- 图片前缀 `!`：`text-text-muted`

### 7. 强调语法

```md
**bold**
*italic*
~~strike~~
```

- `**` / `__`：`text-purple-400`
- 粗体内容：`font-bold text-text-bright`
- `*` / `_`：`text-purple-400`
- 斜体内容：`italic text-purple-300`
- `~~`：`text-text-muted`
- 删除线内容：`text-text-muted line-through opacity-70`

说明：

- 当前实现带有边界判断，尽量避免把 `foo_bar_baz` 这种普通标识符误判为 Markdown 斜体。

### 8. 表格

```md
| Name | Value |
| ---- | ----- |
| A    | 1     |
```

- `|` 分隔符：`text-text-secondary`
- 对齐分隔线 `---` / `:---:`：`text-brand-orange/80`
- 单元格内容：继续走 inline 语法高亮

### 9. 脚注与分隔线

```md
[^1]
[^1]: footnote

---
```

- 脚注定义标记：`text-brand-blue`
- 脚注内容：`text-text-muted`
- 水平分隔线：`text-brand-orange/70`

---

## 集成方式

### 1. Markdown 检测

`detectMarkdown(content)` 使用一组轻量正则判断常见 Markdown 结构：

- headings
- emphasis
- links
- code fence / inline code
- lists / task lists
- blockquotes
- tables
- horizontal rules
- footnotes

### 2. Formatted Content 接入

在 `renderFormattedContent(event)` 中：

- 优先提取 message / reasoning / context 的文本内容
- 对非加密 reasoning 允许 Markdown 检测
- 命中时渲染 `<MarkdownRenderer content={markdownContent} />`
- 未命中时保持原本纯文本逻辑

### 3. 当前依赖策略

当前实现不依赖额外 Markdown 渲染库。

原因：

- 需求是源码高亮，不是结构渲染
- 正则 + 按行扫描已足够覆盖当前 trace 里的高频 Markdown 格式
- 避免引入 AST 渲染后的样式偏移、HTML 安全边界和额外依赖成本

---

## 限制与后续优化

### 当前限制

1. 这是语法高亮器，不是完整 Markdown parser
2. 围栏代码块没有语言级 token 高亮，只有统一代码语义色
3. 极少数复杂嵌套语法或非标准 Markdown 方言可能不会 100% 准确命中
4. 目前只对 `Formatted Content` 生效，不影响其他 preview 区域

### 可能的后续优化

1. 为 fenced code 增加更细粒度的 token 颜色
2. 为 table alignment、footnote reference 增加更精细样式
3. 将高亮规则抽成 token map，便于后续主题化
4. 为 preview 区域按需复用同一套 Markdown 源码高亮逻辑

---

## 维护说明

- 本文档应与 `src/components/MarkdownRenderer.tsx` 保持同步
- 若实现方向从“源码高亮”切回“Markdown 渲染”，本文档需要整体重写，而不是局部修补

---

**最后更新**: 2026-04-26
**项目**: Codex Trace Viewer
