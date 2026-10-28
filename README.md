# Obsidian 插件开发仓库

管理 Home Widgets 和 MyCalendar 的源码与发布。笔记、布局、插件设置及运行数据不纳入 Git，需另行备份。

- `HomeWidgets/`、`MyCalendar/`：两个插件的源码、测试和构建目录。
- `shared/`：共用更新核心；`scripts/`、`.github/`：打包与发布工具。
- `.obsidian/plugins/`：本机安装目录，不纳入 Git。

## 开发与部署

在仓库根目录运行，需安装 Node.js、npm 和 Git：

```powershell
# MyCalendar 首次开发或依赖变化时执行
npm --prefix MyCalendar ci

# 构建并安装到当前 Vault，保留 data.json
npm --prefix HomeWidgets run deploy
npm --prefix MyCalendar run deploy
```

部署后重启 Obsidian。只构建时将 `deploy` 换成 `build`，产物在各项目的 `build/`。

验证：各项目运行 `npm test`；MyCalendar 另运行 `npm run typecheck`。共用更新器测试为 `node --test shared/tests`，运行前先构建两个插件。

当前组件规则：唯一首页布局 `Home/widgets.json`（version 3），分类待办允许多实例，其余内置组件与 MyCalendar 为全库单实例。倒计时使用 version 2 单列表和 version 2 日历来源契约；外部组件注册 API 为 v3。双方需要同时更新，旧数据先备份并一次性整理。

## 保存与回滚

```powershell
git status
git add HomeWidgets MyCalendar shared scripts .github AGENTS.md README.md .gitignore
git commit -m "fix(my-calendar): 修复日期高亮"

# 回滚前先保存当前改动；将 <提交编号> 替换为实际编号
git log --oneline
git revert <提交编号>
```

提交信息遵循 Conventional Commits：`type(scope): description`。回滚后重新部署对应插件；代码回滚不会恢复用户数据。

## 发布 Release

先提高有改动插件的 `manifest.json` 和 `package.json` 版本；MyCalendar 同步修改锁文件中的根包版本。提交后选择一种发布方式：

```powershell
.\scripts\Publish-Plugins.ps1                       # 补丁版本，默认
.\scripts\Publish-Plugins.ps1 -Bump Minor           # 次版本
.\scripts\Publish-Plugins.ps1 -Bump Major           # 大版本
.\scripts\Publish-Plugins.ps1 -Tag "plugins-2.0.0"  # 指定标签
```

`plugins-x.x.x` 是发布批次标签，与两个插件自身的版本独立。脚本推送提交和标签后，GitHub Actions 自动测试、打包并发布到 [Releases](https://github.com/GuoXBQ-Q/MyObsidianPlugins/releases)。运行文件变化却未提高插件版本时，CI 会阻止发布。

每次仅发布 `home-widgets.zip` 和 `my-calendar.zip`，包内包含 `main.js`、`manifest.json`、`styles.css`。Release 正文中的更新元数据由构建工具生成，请保留。

## 安装更新与恢复

首次从 Release 下载 ZIP，将三个文件放入对应插件安装目录并重启。以后在各插件设置的“插件更新”中操作：开启自动检查后，启动时检查一次，此后每 24 小时检查；关闭后仍可手动检查。自动检查只检测并提示，点击“下载并安装”并在弹窗确认后才下载安装，重启生效。安装后、重启前会显示当前运行与已安装版本，并禁止重复安装。检查失败会提供重试入口；保留的旧版本信息会标为上次结果。需要能访问 GitHub；安装更新仅支持桌面端。

更新前会校验文件并备份，失败时自动恢复。若插件无法加载，关闭 Obsidian，将插件目录中 `.github-updater/backup/` 的三个文件复制回插件目录，再删除 `.github-updater/transaction.json` 并重启。

请保留 `data.json`，并另行备份插件数据、`Home/widgets.json` 等布局及个人笔记。
