# Qifa Quiz

一个面向中文题库的轻量刷题网站，支持手机和电脑端。

## 已实现

- 单选题、多选题、判断题练习
- 提交后即时查看正确答案和解析
- 自动记住上次刷到的位置
- Excel 题库导入入口
- SQLite 题库、练习会话、答题记录和续练位置
- 题库管理登录、导入预览、错误行反馈和模板下载
- 题库进度、正确率、随机练习和错题练习
- 响应式布局，适配手机与电脑

## 题库格式

建议 Excel 使用以下列：`题目`、`题型`、`选项`、`答案`、`解析`、`分类`。

## 本地运行

```bash
npm install
npm run dev
```

## 自托管运行

```bash
cp .env.example .env
# 设置至少 12 位的 ADMIN_PASSWORD
npm run build:selfhost
docker compose up -d --build
```

接口健康检查：`GET /api/health`。管理接口使用题库管理密码登录后调用，题库导入先预览再写入数据库。

## 许可证

MIT
