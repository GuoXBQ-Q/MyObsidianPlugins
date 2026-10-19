# Obsidian 插件开发仓库

此 Git 仓库建立在 vault 根目录，通过 `.gitignore` 白名单跟踪两个插件的开发工程、`scripts/`、`.github/`、`AGENTS.md`、本说明和根目录忽略规则。普通笔记、首页布局、`.obsidian/`、其他插件、个人设置及实际使用数据不纳入本仓库。

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
git add HomeWidgets MyCalendar scripts .github AGENTS.md README.md .gitignore
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

脚本创建 `plugins-日期时间-提交编号` 标签，并将当前分支和标签推送到 [GitHub 仓库](https://github.com/GuoXBQ-Q/MyObsidianPlugins)。GitHub Actions 自动测试、构建并校验压缩包，通过后发布到 [Releases](https://github.com/GuoXBQ-Q/MyObsidianPlugins/releases)。

Release 仅提供 `home-widgets.zip` 和 `my-calendar.zip`。每个压缩包根目录只包含对应插件的 `main.js`、`manifest.json` 和 `styles.css`。

根目录 `scripts/` 保留两个发布工具：

| 脚本 | 用途 |
| --- | --- |
| `Build-PluginRelease.ps1` | 构建两个插件、生成并校验 ZIP，供 GitHub Actions 调用；也可用于本地打包 |
| `Publish-Plugins.ps1` | 检查工作区、创建并推送发布标签，触发 GitHub Actions |

单独执行本地打包可运行 `.\scripts\Build-PluginRelease.ps1 -Tag "plugins-local-build"`，需先安装 MyCalendar 开发依赖。结果保存在 `.plugin-releases/`，不纳入 Git；同名输出目录已存在时请换用新标签。
