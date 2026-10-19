# Obsidian 插件开发仓库

此 Git 仓库建立在 vault 根目录，通过 `.gitignore` 白名单跟踪两个插件的开发工程、`scripts/`、`tests/`、`.github/`、`AGENTS.md`、本说明和根目录忽略规则。普通笔记、首页布局、`.obsidian/`、其他插件、个人设置及实际使用数据不纳入本仓库。

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
git add HomeWidgets MyCalendar scripts tests .github AGENTS.md README.md .gitignore
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

## 两台 Windows 电脑之间发布更新

远程仓库：[GuoXBQ-Q/MyObsidianPlugins](https://github.com/GuoXBQ-Q/MyObsidianPlugins)。此仓库为公开仓库，使用机下载更新无需 GitHub 登录，也无需 Git 或 Node.js。

### 宿舍电脑：提交后运行一次发布命令

```powershell
.\scripts\Publish-Plugins.ps1
```

脚本要求工作区干净，使用当前已提交的代码创建 `plugins-日期时间-提交编号` 标签，并将当前分支和这个标签一起推送到 `origin`。它不会自动提交文件或强制覆盖远程历史。首次推送需通过 Git 自带的凭据管理器登录你的 GitHub 账户；可写权限必须覆盖代码和工作流文件。

GitHub Actions 随后自动执行插件测试和类型检查、构建两个插件，并在 [Releases](https://github.com/GuoXBQ-Q/MyObsidianPlugins/releases) 生成三个下载文件：

- `obsidian-plugins.zip`：两个插件的程序文件、版本和源码提交编号。
- `SHA256SUMS`：发布包的 SHA-256 校验值。
- `Update-Plugins.ps1`：可独立运行的更新脚本。

构建状态见 [Actions](https://github.com/GuoXBQ-Q/MyObsidianPlugins/actions)。只有检查通过才发布更新，不会每次保存源码就推送到使用机。两个插件使用同一个发布标签，插件各自的 `manifest.json` 版本仍独立维护。

### 另一台电脑：首次下载脚本，此后运行同一命令

从最新 Release 下载 `Update-Plugins.ps1` 到固定位置。先关闭 Obsidian，再在该脚本所在目录运行（替换为这台电脑实际的 vault 路径）：

```powershell
.\Update-Plugins.ps1 -VaultPath "D:\Obsidian\我的知识库"
```

脚本自动查询最新发布、下载并校验完整发布包，备份旧插件代码，再安装两个插件。相同程序文件不会重复安装；`data.json`、首页布局、普通笔记和其他插件文件保留。完成后重新打开 Obsidian；首次安装时在第三方插件设置中启用两个插件。

如 Windows 阻止从网上下载的脚本，检查文件来源后可对这个文件运行 `Unblock-File .\Update-Plugins.ps1`。若仍提示执行策略禁止脚本，可仅对当前进程使用 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Update-Plugins.ps1 -VaultPath "D:\Obsidian\我的知识库"`，无需修改全局执行策略。

检查发布包而不安装：

```powershell
.\Update-Plugins.ps1 -VaultPath "D:\Obsidian\我的知识库" -CheckOnly
```

回到历史发布的代码：在 Releases 找到之前的完整标签，用 `-Tag` 指定它。旧版本不兼容新数据格式时应先处理数据兼容问题。

```powershell
.\Update-Plugins.ps1 -VaultPath "D:\Obsidian\我的知识库" -Tag "plugins-实际历史标签"
```

每次安装前的代码备份位于 vault 的 `.obsidian/plugin-update-backups/`，其中只有原有的三个插件程序文件。复制中途失败时脚本尝试恢复原文件；如恢复失败，会提示备份位置供手动恢复。

### 本地验证发布流程

以下命令只构建本地包、验证临时 vault，不上传或修改当前已安装的插件。MyCalendar 需已执行 `npm ci`。

```powershell
.\scripts\Build-PluginRelease.ps1 -Tag "plugins-local-check"
.\tests\plugin-release.test.ps1 -PackagePath ".plugin-releases\plugins-local-check\obsidian-plugins.zip"
```

构建结果保存在 `.plugin-releases/`，不纳入 Git。同名本地输出目录已存在时应使用新的标签。上述脚本支持 Windows PowerShell 5.1 和 PowerShell 7；它们负责程序发布，个人数据继续通过原有备份与同步方式管理。
