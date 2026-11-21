# 香港智慧城市地圖

可互動的香港地圖。底圖使用 [OpenFreeMap](https://openfreemap.org/) 的免費公開服務。地圖顯示十條港鐵重鐵路線和車站，以及運輸署交通快拍點。

- 點選車站，可查看該站即將到站的班次。
- 放大後會出現交通快拍點。點選可查看該處最新照片。
- 沒有班次或照片未能載入時，畫面上會寫明原因。

輕鐵不在港鐵實時列車資料之內，因此沒有畫上。

## 資料

- 到站班次：港鐵 Next Train API，`https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php`
- 站名和路線：港鐵《港鐵綫及車站》；馬場站按列車接口規格補上
- 路軌和車站位置：OpenStreetMap
- 快拍位置和照片：運輸署交通情況快拍圖像

位置資料已做成網站裡的靜態檔。班次和照片在點選時才向官方網址讀取。

更新靜態位置資料：

```bash
python3 scripts/build_data.py
```

## 在本機預覽

```bash
npm install
npm test
npm run dev
```

然後打開 http://127.0.0.1:5173 。

## 正式發佈

預覽驗收之後，才發佈到 Cloudflare Workers 免費方案，使用帳戶自帶的 `workers.dev` 網址。不使用自訂網域、KV、D1 或 R2。靜態網頁的請求不計入每日程式請求額度，預計費用是 0 美元。

Wrangler 已裝在專案的開發依賴裡。`npm install` 之後可用：

```bash
npx wrangler login
npm run deploy
```

`npm run deploy` 會先建置網站，再發佈到現有的 `hk-smart-city-map` Worker。正式網址是 https://hk-smart-city-map.superbpang.workers.dev/ 。
