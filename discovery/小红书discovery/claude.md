# XHS Discovery Data - Context for `/huashu-data-pro`

## 📌 概述 (Overview)
本目录包含了从小红书 (XHS) 抓取并整理的用户调研数据。这些数据已经按照不同的调研维度和关键词进行了分类。
当 `/huashu-data-pro` 技能被触发时，请**读取并解析**本目录（`discovery/`）下的所有结构化数据，随后按照你预设的技能分析逻辑进行处理。

## 📂 目录与分类结构 (Directory Structure)
数据主要存放在嵌套的 `discovery/discovery/` 路径下，分为三个核心维度的子文件夹：

1. **挖掘用户的“恐惧与痛点” (Fears & Pain Points)**
   - 包含文件如：`granola app吐槽.xlsx`, `对PPT 补笔记 崩溃.xlsx` 等。
2. **挖掘用户的“核心需求与期望” (Needs & Expectations)**
   - 包含文件如：`夸克 AI 听网课.xlsx`, `音视频 双栏 笔记 软件.xlsx` 等。
3. **挖掘用户的“行为习惯与认知” (Behaviors & Cognition)**
   - 包含文件如：`ai 公式推导 怎么记.xlsx`, `ChatGPT gemini整理 课堂笔记.xlsx` 等。

## 📊 数据文件格式 (Data Schema)
目录底部的所有文件均为 `.xlsx` (Excel) 格式。为了准确读取数据，**请务必注意每个 Excel 文件内部都包含以下两个固定的工作表 (Sheets)**：

* **`contents`** 表：存储了小红书帖子/笔记的正文核心内容。
* **`comments`** 表：存储了该笔记下方对应的用户评论数据。

## 🚀 给 Agent 的执行指令 (Execution Instructions)
1. **遍历目录**：请递归扫描并读取 `discovery/` 下所有的 `.xlsx` 文件。
2. **双表解析**：在读取每个 Excel 文件时，必须同时提取 `contents` 和 `comments` 两个 Sheet 的信息。
3. **保留元数据**：请将文件所在的“父文件夹名称（分类标签）”以及“文件本身的名称（搜索关键词）”作为处理该文件内数据时的重要上下文背景。
4. **运行原生逻辑**：在成功识别并加载上述数据结构后，请无需询问，直接启动 `/huashu-data-pro` 内部定义的数据分析与话术提炼流程。

## 备注
我将运行/huashu-data-pro用来分析数据，当我触发这个skill的时候，请先向我确认详细信息，然后给出执行计划，等用户确认之后在开始执行。

请严格按照skill的流程来进行。