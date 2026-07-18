# 🃏 像素小丑牌（网页版，含多人对战）

用扑克牌型得分的 Roguelike 卡牌构筑游戏。单文件 HTML + 零依赖 Node 服务器。

## 本地运行

```
node server.js
```

浏览器打开 http://localhost:8080 即可。多人对战需双方能访问同一服务器。

## 云端部署（Render 免费版）

1. 把本仓库推到 GitHub
2. 在 [render.com](https://render.com) 新建 Web Service，连接本仓库
3. 启动命令 `node server.js`，选 Free 套餐
4. 部署完成后获得 `https://xxx.onrender.com`，打开即玩（免费版闲置会休眠，首次打开等约半分钟）

## 更新游戏内容

本目录的 `balatro.html` 是部署副本。主目录的游戏文件改动后，复制过来再提交推送即可：

```
cp ~/balatro.html ~/balatro-online/balatro.html
cd ~/balatro-online && git add -A && git commit -m "update" && git push
```
