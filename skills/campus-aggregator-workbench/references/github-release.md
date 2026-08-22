# GitHub 发布清单

建议目录：

```text
README.md
docs/                         # 产品、架构、部署和视频处理说明
skills/campus-aggregator-workbench/
cloudfunctions/               # api、rag、crawler
pages/ components/ utils/     # 小程序源码
```

提交前执行 `git status`、密钥扫描和语法测试。`.env`、云开发配置、用户数据、视频缓存、日志和 `decode_key` 必须加入 `.gitignore`。README 以个人项目口吻说明目标、功能、安装、环境变量、部署和隐私边界，不写任何 AI 代写或辅助署名。

当前工作区没有 GitHub remote，且未安装 GitHub CLI；只有在用户提供仓库 URL 或配置 remote 后才能安全执行 `git push`。
