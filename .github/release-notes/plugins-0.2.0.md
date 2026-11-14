# plugins-0.2.0 — 2026-11-14

MyCalendar 新增桌面月历拖拽改期和排序，并修复 Obsidian 持续打开时的跨日显示问题。

| 插件 | 上一发布版本 | 本次版本 | 最低 Obsidian 版本 |
| --- | --- | --- | --- |
| Home Widgets | 0.2.7 | 0.2.7（未变） | 1.5.0 |
| MyCalendar | 1.4.5 | 1.5.0 | 1.4.0 |

## 新增 Added

- [MyCalendar] 在独立月历或 Home Widgets 首页月历中，用鼠标将日程拖到另一天，或在同一天内调整顺序。两处月历共享保存的顺序。
- [MyCalendar] 从起始日期拖动跨天日程时，整条日程一起移动，保留跨度和时间。已有续段保持原行，目标行冲突时会提示该位置不可用。
- [MyCalendar] 拖动时可预览落点，悬停上月或下月按钮约 600 毫秒可翻页。松手保存后，可在 10 秒内撤销最近一次拖拽。

## 修复 Fixed

- [MyCalendar] Obsidian 窗口重新获得焦点，或日历获得焦点、被点击时会检查日期。跨日后刷新「今天」标记，正在查看当前日期的视图随之更新，手动浏览时保留所选日期。

## 安装与更新

- 已安装用户可在 MyCalendar 设置中检查更新，安装后重启 Obsidian。
- 手动安装可下载对应 ZIP，将其中的 `main.js`、`manifest.json`、`styles.css` 放入插件安装目录，保留 `data.json`，然后重启 Obsidian。

## 验证

- MyCalendar、Home Widgets 和插件更新器自动化测试、TypeScript 类型检查及打包集成测试通过。

## 完整变更

[plugins-0.1.7 → plugins-0.2.0](https://github.com/GuoXBQ-Q/MyObsidianPlugins/compare/plugins-0.1.7...plugins-0.2.0)
