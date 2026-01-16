# Text to Quoted List

一个油猴脚本（Tampermonkey/Greasemonkey），用于将复制的文本快速转换为带引号的列表格式，方便生成 SQL IN 语句等场景。

## 功能特性

- **自动检测**：复制分隔符分隔的文本（如换行、逗号、分号等）时，自动弹出转换面板
- **一键转换**：将文本转换为 `'a','b','c'` 或 `"a","b","c"` 格式
- **智能识别**：自动排除 SQL 语句、代码片段等误触发
- **便捷交互**：
  - 可拖拽的悬浮 Logo
  - 点击页面空白处自动收起面板
  - 支持 `Esc` 快捷键关闭
- **位置记忆**：Logo 位置会自动保存

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 或 [Greasemonkey](https://www.greasespot.net/) 浏览器扩展
2. 点击 [安装脚本](https://raw.githubusercontent.com/dontloseyourway/text-to-quoted-list/main/text-to-quoted-list.user.js)
3. 确认安装

## 使用方法

1. 在任意网页选中文本并复制（Cmd/Ctrl+C）
2. 如果文本看起来像列表（如 `a,b,c` 或多行文本），会自动弹出转换面板
3. 点击「复制（单引号）」或「复制（双引号）」获取转换结果
4. 也可以点击右下角的 Logo 手动打开面板

## 示例

输入：
```
apple
banana
orange
```

输出（单引号）：
```
'apple','banana','orange'
```

输出（双引号）：
```
"apple","banana","orange"
```

## License

MIT
