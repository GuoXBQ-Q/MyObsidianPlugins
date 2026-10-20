# Obsidian 插件开发仓库

此 Git 仓库建立在 vault 根目录，通过 `.gitignore` 白名单跟踪两个插件的开发工程、`shared/`、`scripts/`、`.github/`、`AGENTS.md`、本说明和根目录忽略规则。普通笔记、首页布局、`.obsidian/`、其他插件、个人设置及实际使用数据不纳入本仓库。

```text
demo/
├─ HomeWidgets/                 Home Widgets 源码、测试和开发文档
│  ├─ src/
│  ├─ scripts/
│  ├─ tests/
│  └─ build/                    构建产物，不纳入 Git
├─ MyCalendar/                  MyCalendar 源码、测试和开发文档
│  ├─ src/
│  ├─ scripts/
│  ├─ tests/
│  ├─ package-lock.json         固定依赖版本，纳入 Git
│  └─ build/                    构建产物，不纳入 Git
├─ shared/                      共用更新核心与行为测试，分别打包进两个插件
└─ .obsidian/plugins/           安装目录，不纳入 Git
   ├─ home-widgets/
   └─ my-calendar/
```

两个插件的安装目录均保留 `main.js`、`manifest.json`、`styles.css` 和运行期间保存的 `data.json`。修改源码后部署，部署脚本只复制前三个文件，保留真实数据。

## 构建与部署

在 vault 根目录运行：

```powershell
# Home Widgets 无需安装依赖
npm --prefix HomeWidgets run build
npm --prefix HomeWidgets run deploy

# MyCalendar 在首次开发或依赖变化时安装依赖
npm --prefix MyCalendar ci
npm --prefix MyCalendar run typecheck
npm --prefix MyCalendar run build
npm --prefix MyCalendar run deploy
```

`build` 只生成构建产物；`deploy` 会先执行生产构建，再安装到当前 vault。部署后在 Obsidian 中关闭再启用对应插件，或重新加载应用。修改 `manifest.json` 后重启 Obsidian。

## 日常保存与回滚

在 vault 根目录检查修改并保存一个可用版本：

```powershell
git status
git diff
git add HomeWidgets MyCalendar shared scripts .github AGENTS.md README.md .gitignore
git diff --cached --stat
git commit -m "fix(my-calendar): 说明这次修复"
```

查看历史，撤销某次已提交的修改（将 `<提交编号>` 换成实际编号）：

```powershell
git log --oneline --decorate
git revert <提交编号>
```

撤销前先提交当前需要保留的修改。`revert` 新建一次撤销提交，保留原有历史；涉及两个插件接口的联动修改建议放在同一次提交中。Git 只记录已提交的版本，不会自动为每次文件保存建立历史。

回滚后重新执行受影响插件的构建和部署，再重新加载插件。MyCalendar 的依赖锁文件变化时，先在其源码目录运行 `npm ci`。初始可回滚版本使用标签 `baseline-2026-10-18` 标识。

## 数据与备份

本仓库管理插件代码。日程、倒计时、首页布局和笔记需另外备份，重点包括：

- `.obsidian/plugins/my-calendar/data.json`：实际日程、设置及在线节假日数据。
- `.obsidian/plugins/home-widgets/data.json`：倒计时和插件设置。
- `Home/widgets.json` 等布局文件，以及 `Home/`、`Inbox/` 中实际使用的笔记和附件。

回滚代码不会回滚上述数据；使用旧代码前需留意数据格式是否兼容。

## 发布构建产物

修改代码并提交后，在 vault 根目录运行：

```powershell
.\scripts\Publish-Plugins.ps1
```

脚本先获取远程标签，再按已有 `plugins-x.x.x` 标签中的最高版本自动递增补丁版本，例如 `plugins-0.1.0` → `plugins-0.1.1`。没有此类标签时从 `plugins-0.1.0` 开始，旧的日期标签不参与版本计算。随后将当前分支和新标签推送到 [GitHub 仓库](https://github.com/GuoXBQ-Q/MyObsidianPlugins)。GitHub Actions 自动测试、构建并校验压缩包，通过后发布到 [Releases](https://github.com/GuoXBQ-Q/MyObsidianPlugins/releases)。

需要提升次版本或大版本时，可选择递增级别，也可直接指定完整标签名：

```powershell
# 补丁版本：0.1.0 -> 0.1.1（默认行为）
.\scripts\Publish-Plugins.ps1

# 次版本：0.1.1 -> 0.2.0
.\scripts\Publish-Plugins.ps1 -Bump Minor

# 大版本：0.2.0 -> 1.0.0，或 1.2.3 -> 2.0.0
.\scripts\Publish-Plugins.ps1 -Bump Major

# 手动指定发布版本
.\scripts\Publish-Plugins.ps1 -Tag "plugins-2.0.0"
```

`-Tag` 与 `-Bump` 二选一。标签必须符合 `plugins-x.x.x` 格式，重复标签会被拒绝；已发布的历史标签保留。这个版本号表示两个插件的统一发布批次，插件各自的 `manifest.json` 版本仍独立维护，不会随发布标签自动修改。

Release 仅提供 `home-widgets.zip` 和 `my-calendar.zip`。每个压缩包根目录只包含对应插件的 `main.js`、`manifest.json` 和 `styles.css`。

插件内更新以各自的 `manifest.json` 版本为准，使用 `x.y.z` 格式。修改运行代码或样式后，发布前提高对应插件的版本，并同步修改 `package.json`（MyCalendar 还包括锁文件中的根包版本）。插件大版本更新时修改插件自身的主版本；发布批次标签独立选择。例如发布 `plugins-1.0.0` 时，Home Widgets 可以是 `0.2.0`，MyCalendar 可以是 `1.4.0`。

构建工具在 Release 正文中自动添加 `obsidian-plugin-updates:v1` 标记的 JSON 元数据，供更新器读取；请勿手工删除或改写。GitHub Actions 使用上一正式 Release 的两个 ZIP 逐文件比较：运行文件变化而插件版本未提高，或版本降低时会阻止发布。首次发布无上一版本时跳过比较。只检查更新时读取元数据，不下载 ZIP。

根目录 `scripts/` 保留两个发布工具：

| 脚本 | 用途 |
| --- | --- |
| `Build-PluginRelease.ps1` | 构建两个插件、生成并校验 ZIP，供 GitHub Actions 调用；也可用于本地打包 |
| `Publish-Plugins.ps1` | 检查工作区、计算或指定发布版本、创建并推送标签，触发 GitHub Actions |

`scripts/check-plugin-release.cjs` 负责 CI 的上一版本比较。可以给本地打包命令增加 `-CheckPreviousRelease` 执行相同的联网检查；默认本地打包不联网。

单独执行本地打包可运行 `.\scripts\Build-PluginRelease.ps1 -Tag "plugins-0.0.0"`，需先安装 MyCalendar 开发依赖。结果保存在 `.plugin-releases/`，不纳入 Git；此命令不创建 Git 标签。同名输出目录已存在时请换用新版本号。

## 插件内检查与安装更新

两个插件各自的设置页都有“插件更新”。桌面端默认启动 15 秒后检查，此后每 24 小时检查一次；最近 24 小时已检查时跳过启动检查。可以关闭自动检查，或随时点击“立即检查”。检查固定访问本仓库的最新正式 Release；需要能直接访问 GitHub，不要求登录或填写 Token。草稿、预发布和没有更新元数据的历史 Release 不会安装。

发现新版本后提示一次，点击“下载并安装”才下载对应 ZIP。更新器验证 GitHub SHA-256、ZIP 内容、插件 ID、目标版本及最低 Obsidian 版本，再备份并替换三个运行文件。安装后显示运行版本和已安装版本，重启 Obsidian 生效；安装期间和待重启期间不能重复安装。移动端保持原功能，暂不提供安装更新。

首次使用需手动安装一次包含更新功能的版本，建议至少使用 Home Widgets `0.2.1`、MyCalendar `1.4.1`（修复桌面端定时器初始化错误）。两个插件可以独立安装，无需同时启用。

更新器状态保存在实际插件目录的 `.github-updater/state.json`，不写入插件原有 `data.json`。同目录下的 `backup/` 保留最近一次安装前的三个运行文件，`transaction.json` 记录事务，`stage/` 保存临时文件。正常安装失败会自动恢复；异常退出后，插件能够加载时会尝试恢复未完成事务并提示重启。

若 Obsidian 无法加载插件：关闭 Obsidian，将 `.github-updater/backup/` 中的三个文件复制回插件目录，再删除 `.github-updater/transaction.json`，重新打开 Obsidian。也可查看同目录的 `恢复说明.txt`。保留 `data.json`、笔记和布局文件。若提示网络限流、文件校验失败或写入失败，可查看设置页中的具体原因，处理后重新检查。

开发验证：先构建两个插件，再运行 `node --test shared/tests`，覆盖更新器、安装恢复、发布版本检查及打包入口的桌面/移动端加载；两个插件原有测试按各工程的命令执行。临时目录中的模拟测试不替代真实 Obsidian 验收。
