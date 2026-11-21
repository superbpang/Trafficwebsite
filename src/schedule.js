const HK_OFFSET_MS = 8 * 60 * 60 * 1000;
const NEAR_MS = 60 * 1000;
const EMPTY_API_MESSAGE = "the contents are empty!";

function parseHongKong(value, referenceMs) {
  const text = String(value || "").trim();
  const full = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (full) {
    const [, year, month, day, hour, minute, second] = full;
    return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) - HK_OFFSET_MS;
  }
  const clock = /^(\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (!clock) return null;
  const [, hour, minute, second] = clock.map(Number);
  if (referenceMs == null) {
    return Date.UTC(2000, 0, 1, hour, minute, second) - HK_OFFSET_MS;
  }
  const reference = new Date(referenceMs + HK_OFFSET_MS);
  let instant = Date.UTC(
    reference.getUTCFullYear(),
    reference.getUTCMonth(),
    reference.getUTCDate(),
    hour,
    minute,
    second,
  ) - HK_OFFSET_MS;
  if (instant - referenceMs < -12 * 60 * 60 * 1000) instant += 24 * 60 * 60 * 1000;
  return instant;
}

export function minutesLabel(trainTime, referenceTime) {
  const reference = parseHongKong(referenceTime);
  const train = parseHongKong(trainTime, reference);
  if (reference == null || train == null) return "";
  const diff = train - reference;
  if (diff < NEAR_MS && diff >= -NEAR_MS) return "即將到站";
  if (diff < 0) return "";
  return `${Math.floor(diff / 60000)} 分鐘`;
}

export function routeLabel(route) {
  return route === "RAC" ? "經馬場" : "";
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

function failureNotice(payload) {
  const message = typeof payload?.message === "string" ? payload.message.trim() : "";
  if (message && message.toLowerCase() !== EMPTY_API_MESSAGE) return message;
  return "暫無到站班次。港鐵未有提供此站的班次資料。";
}

function asTrains(list, namesByCode, referenceTime) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    const dest = item?.dest || "";
    return {
      dest,
      destName: namesByCode[dest] || dest || "未知目的地",
      minutesLabel: minutesLabel(item?.time, referenceTime),
      clock: clockLabel(item?.time),
      platform: item?.plat ? String(item.plat) : "",
      route: item?.route === "RAC" ? "RAC" : "",
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
      notice: failureNotice(payload),
      directions: [],
    };
  }

  const bucket = payload?.data?.[`${line}-${sta}`] || {};
  const directions = ["UP", "DOWN"].map((id) => ({
    id,
    trains: asTrains(bucket[id], namesByCode, updated),
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
