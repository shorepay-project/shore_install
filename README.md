# ShorePay V2 内测分发

这个仓库复用旧安装页的页面、二维码和安装清单生成逻辑，只展示本仓库的 ShorePay 测试包。APK 和 IPA 存在 GitHub Releases；GitHub Actions 从 Release 读取包信息，生成安装页并部署 GitHub Pages。仓库不会自动删除历史 Release。

分发页预计地址：<https://shorepay-project.github.io/shore_install/>。首次推送后，在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**，然后运行 `Publish distribution page` 工作流。Pages 部署成功后再确认地址可用。

## 本地打包与发布

在 Mac 上准备 Flutter、Xcode、Android SDK、GitHub CLI、ShorePay 的构建环境、Android 正式签名密钥，以及含测试设备 UDID 的 iOS Ad Hoc 证书和 provisioning profile。ShorePay 源码必须位于已审核并推送的 `main_v2`，本地 `HEAD` 要与 `origin/main_v2` 一致，工作区必须干净。

从本仓库运行：

```bash
VERSION_CODE=26100601 ./scripts/build-and-publish.sh
```

把示例中的 `VERSION_CODE` 换成本次发布使用的产品版本码。

脚本依次执行 ShorePay 的 `build_release.sh apk --skip-reseed` 和 `build_release.sh ipa --skip-reseed`，检查两份新产物，然后创建含 APK 与 IPA 的 GitHub Release。现有构建脚本仍会按原设置上传符号；构建或符号上传失败时不会发布安装包。

如果已经手工打好两个包，可直接运行：

```bash
node scripts/publish-local.mjs \
  --apk /absolute/path/app-release.apk \
  --ipa /absolute/path/ShorePay.ipa \
  --dry-run

node scripts/publish-local.mjs \
  --apk /absolute/path/app-release.apk \
  --ipa /absolute/path/ShorePay.ipa
```

发布脚本核对两个包的 `com.cloudsshore.wallet` 包名、版本，验证 APK 签名不使用 Android Debug 证书，并验证 IPA 的代码签名及包含登记设备的 provisioning profile。Release 中写入源码提交号；Release 发布后，工作流在 main 上重新生成并部署页面（Pages 只采用 main 上的部署，tag 上的部署不会生效）。建议先在测试设备上验证新 Release 的安装流程。

可用 `SHOREPAY_APP_DIR=/absolute/path/to/shorepay` 指定源码目录。

## Lark 群通知

Release 发布后，main 上的部署成功时，工作流会运行通知步骤。要把 **iOS 和 Android 的最新版本二维码图片** 直接发到指定群，先在 Lark 开放平台创建企业自建应用，开启机器人和消息/图片权限，将机器人加入群，然后在本仓库 **Settings → Secrets and variables → Actions** 添加：

| Secret | 用途 |
| --- | --- |
| `LARK_APP_ID` | 企业自建应用的 App ID |
| `LARK_APP_SECRET` | 应用密钥 |
| `LARK_CHAT_ID` | 指定群的 `chat_id` |

如果只有群自定义机器人的 Webhook，可设置 `LARK_WEBHOOK_URL`。这种方式发送最新版本和分发页链接，群成员打开页面可查看二维码；发送二维码图片需要上面的自建应用凭据。未设置任何 Lark Secret 时，通知步骤会跳过。

不要把这些凭据写入仓库、Release 描述或群消息。GitHub 仓库当前是公开的，因此 Release 安装包和 Pages 页面也对外可访问；iOS 设备名单只限制安装，不限制下载。若测试包不能公开，应先改用受控的私有存储和访问方式。

## 维护与验证

```bash
npm ci
npm test
```

`config.json` 管理仓库地址、Pages 地址和页面标题。`scripts/build-metadata.mjs` 负责解析 Release 和生成 `docs/apps.json`、iOS manifest；生成文件由 Actions 作为 Pages artifact 发布，不提交到 Git 历史。页面展示最近三个版本，历史 Release 仍保留在 GitHub。

内测升级检测读取 `apps.json` 中 iOS 和 Android 条目的 `versionCode`，两端都与应用运行时注入的 `VERSION_CODE` 比较。发布时优先在 Release 描述中单独写一行 `VERSION_CODE: YYMMDDNN`；同时发布 APK 时，生成器也可从 APK 文件名末尾的八位码补出该字段。只发布 IPA 时必须写明这一行，否则该版本不会触发应用内更新提示。显示用的系统 build 号与 `VERSION_CODE` 是不同字段。

旧分发页的其他应用、安装包和历史 Release 没有复制到这个仓库。
