export function minutesLabel(ttnt) {
  if (ttnt == null) return "";
  const text = String(ttnt).trim();
  if (!text || text === "-" || text.toLowerCase() === "n/a") return "";
  const minutes = Number(text);
  if (!Number.isFinite(minutes)) return "";
  if (minutes <= 0) return "即將到站";
  return `${minutes} 分鐘`;
}

export function clockLabel(time) {
  const match = /(\d{2}:\d{2}):\d{2}/.exec(time || "");
  return match ? match[1] : "";
}

export function httpFailure(status) {
  if (status === 429) return "港鐵查詢過於頻繁，請稍後再按重新整理。";
  if (status >= 500) return "港鐵班次服務暫時未能提供資料。";
  return "暫時未能取得到站班次。";
}

function asTrains(list, namesByCode) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    const dest = item?.dest || "";
    return {
      dest,
      destName: namesByCode[dest] || dest || "未知目的地",
      minutesLabel: minutesLabel(item?.ttnt),
      clock: clockLabel(item?.time),
      platform: item?.plat ? String(item.plat) : "",
      uncertain: item?.valid === "N",
    };
  });
}

export function normalizeSchedule(payload, line, sta, namesByCode = {}) {
  const updated = payload?.curr_time || payload?.sys_time || "";
  const delay = payload?.isdelay === "Y";
  const link = typeof payload?.url === "string" && payload.url ? payload.url : null;
  const failed = !payload || payload.status === 0 || payload.status === "0";
  if (failed) {
    return {
      status: "empty",
      line,
      sta,
      delay,
      updated,
      link,
      notice: "暫無到站班次。港鐵未有提供此站的班次資料。",
      directions: [],
    };
  }

  const bucket = payload?.data?.[`${line}-${sta}`] || {};
  const directions = ["UP", "DOWN"].map((id) => ({
    id,
    trains: asTrains(bucket[id], namesByCode),
  }));
  const any = directions.some((direction) => direction.trains.length > 0);
  let notice = "";
  if (!any) {
    notice = sta === "RAC"
      ? "暫無到站班次。馬場站通常只在賽馬日提供列車。"
      : "暫無到站班次。";
  } else if (delay) {
    notice = "港鐵表示列車或有延誤。";
  }
  return {
    status: any ? "ok" : "empty",
    line,
    sta,
    delay,
    updated,
    link,
    notice,
    directions,
  };
}
