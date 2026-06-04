# detector

规则型多信号 detector，用于筛查目标是否复用了当前仓库的代码、构建产物或部署形态。

## 用法

```bash
npm run detect -- offline --source /path/to/source
npm run detect -- offline --bundle /path/to/.next
npm run detect -- offline --deploy /path/to/deploy
npm run detect -- offline --image suspicious/app:latest
npm run detect -- online --url https://target.example --browser --capture-screenshots
```

## 输出

- 终端摘要
- `--json` 时输出完整 JSON
- `--output-dir <dir>` 时额外写出 `report.json` 与 `report.md`

## 当前范围

- `source-tree`
- `bundle-dir`
- `deploy-dir`
- `docker-image`
- `url`

## 设计原则

- 单个弱信号不定罪
- 多层信号聚合
- 同族封顶
- 缺失强信号时限制最高结论
