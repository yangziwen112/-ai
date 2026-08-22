# GitHub 发布说明

## 推荐仓库内容

保留小程序源码、云函数、`skills/campus-aggregator-workbench`、`docs` 和 PlantUML 图。把部署、隐私、采集器、AI 工作流和视频处理拆成独立文档，并在 README 中提供入口。

## 发布前检查

```powershell
git status
rg -n "(DEEPSEEK|TIKHUB|SEARCH).*KEY|TOKEN|decode_key|url_token" --glob "!**/node_modules/**" .
node --check pages/chat/index.js
npm --prefix cloudfunctions/rag test
```

命中密钥、用户数据、临时图片或视频缓存时先移出仓库。公开文档只描述能力和配置变量名，不公开第三方服务端点、调用参数或任何可直接滥用的凭证。

## 远程仓库

当前工作区未配置 Git remote，也没有可用的 GitHub CLI。打开 GitHub 网页不等于本地仓库已绑定；发布前需要在本机配置目标仓库地址和登录凭证，再执行常规提交与推送。
