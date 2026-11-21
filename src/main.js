import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { LINE_BY_CODE, LINES, lineColorExpression, stationColorExpression } from "./lines.js";
import { httpFailure, normalizeSchedule, routeLabel } from "./schedule.js";
import { foldStationText, matchesStation } from "./search.js";

const { Map, NavigationControl } = maplibregl;

const CAMERA_ZOOM = 13;
const panel = document.querySelector("#panel");
const hint = document.querySelector("#zoom-hint");
const legend = document.querySelector("#legend");
const searchForm = document.querySelector("#search-form");
const searchInput = document.querySelector("#search");
const stationList = document.querySelector("#station-list");
const sourceNote = document.querySelector("#source-note");

const state = {
  map: null,
  stations: [],
  cameras: [],
  namesByCode: {},
  visibleLines: new Set(LINES.map((line) => line.code)),
  requestId: 0,
  layersReady: false,
};

function h(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "hidden") node.hidden = true;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function clear(node) {
  node.replaceChildren();
}

function showPanel(nodes) {
  clear(panel);
  panel.hidden = false;
  document.body.classList.add("panel-open");
  panel.append(...nodes);
  panel.scrollTop = 0;
}

function closePanel() {
  state.requestId += 1;
  panel.hidden = true;
  document.body.classList.remove("panel-open");
  clear(panel);
  const source = state.map?.getSource("highlight");
  if (source) source.setData({ type: "FeatureCollection", features: [] });
}

function stationByQuery(query) {
  return state.stations.filter((station) => matchesStation(station.properties, query));
}

function syncLegendPressed() {
  for (const button of legend.querySelectorAll("[data-line]")) {
    const on = state.visibleLines.has(button.dataset.line);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  }
}

function applyLineFilter() {
  syncLegendPressed();
  if (!state.layersReady || !state.map) return;
  const codes = [...state.visibleLines];
  const lineFilter = ["in", ["get", "code"], ["literal", codes]];
  const stationFilter = ["any", ...codes.map((code) => ["in", code, ["get", "lines"]])];
  state.map.setFilter("lines", lineFilter);
  state.map.setFilter("line-casing", lineFilter);
  state.map.setFilter("stations", codes.length ? stationFilter : ["==", ["get", "code"], ""]);
  state.map.setFilter("station-labels", codes.length ? stationFilter : ["==", ["get", "code"], ""]);
}

function renderLegend() {
  const buttons = LINES.map((line) => h("button", {
    type: "button",
    class: "legend-item",
    "data-line": line.code,
    "aria-pressed": "true",
    onClick: () => {
      if (state.visibleLines.has(line.code)) state.visibleLines.delete(line.code);
      else state.visibleLines.add(line.code);
      applyLineFilter();
    },
  }, [
    h("span", { class: "swatch", style: `background:${line.color}` }),
    line.name,
  ]));
  legend.append(
    h("p", { class: "legend-title" }, "港鐵路線"),
    ...buttons,
    h("p", { class: "legend-camera" }, [
      h("span", { class: "swatch camera-swatch" }),
      "交通快拍（放大後顯示）",
    ]),
  );
}

function updateHint() {
  if (!state.map) return;
  const showing = state.map.getZoom() >= CAMERA_ZOOM;
  const nodes = [
    h("p", {}, showing
      ? "交通快拍點已顯示。點選一個點可看該處最新照片。"
      : "放大地圖後，會顯示運輸署的交通快拍點。"),
  ];
  if (!showing) {
    nodes.push(h("button", {
      type: "button",
      onClick: () => state.map.easeTo({ zoom: CAMERA_ZOOM, duration: 600 }),
    }, "放大以查看快拍"));
  }
  clear(hint);
  hint.append(...nodes);
}

function formatListDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-Hant-HK", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Hong_Kong",
  }).format(date);
}

function panelFrame(title, subtitle, body, onRefresh) {
  return [
    h("div", { class: "panel-head" }, [
      h("div", {}, [
        h("h2", {}, title),
        subtitle ? h("p", { class: "subtitle" }, subtitle) : null,
      ]),
      h("div", { class: "panel-actions" }, [
        onRefresh ? h("button", { type: "button", onClick: onRefresh }, "重新整理") : null,
        h("button", { type: "button", onClick: closePanel }, "關閉"),
      ]),
    ]),
    h("div", { class: "panel-body" }, body),
  ];
}

function trainRow(train) {
  const when = [train.minutesLabel, train.clock].filter(Boolean).join(" · ");
  const platform = train.platform ? `月台 ${train.platform}` : "";
  const via = routeLabel(train.route);
  return h("li", {}, [
    h("strong", {}, `往${train.destName}`),
    h("span", {}, when || "時間待定"),
    platform ? h("span", { class: "muted" }, platform) : null,
    via ? h("span", { class: "muted" }, via) : null,
  ]);
}

function renderSchedule(station, results) {
  const names = station.properties.lines
    .map((code) => LINE_BY_CODE[code]?.name)
    .filter(Boolean)
    .join("、");
  const blocks = results.map((result) => {
    const line = LINE_BY_CODE[result.line];
    const head = h("h3", {}, [
      h("span", { class: "swatch", style: `background:${line.color}` }),
      line.name,
    ]);
    if (result.error) {
      return h("section", { class: "line-block" }, [
        head,
        h("p", { class: "message" }, result.error),
      ]);
    }
    const schedule = result.schedule;
    const any = schedule.directions.some((direction) => direction.trains.length > 0);
    const parts = [head];
    if (schedule.updated) parts.push(h("p", { class: "muted" }, `資料時間 ${schedule.updated}`));
    if (schedule.notice) parts.push(h("p", { class: "message" }, schedule.notice));
    if (schedule.link) {
      parts.push(h("p", {}, [
        h("a", { href: schedule.link, target: "_blank", rel: "noreferrer" }, "查看港鐵特別交通安排"),
      ]));
    }
    if (any) {
      for (const direction of schedule.directions) {
        parts.push(direction.trains.length
          ? h("ol", { class: "trains" }, direction.trains.map(trainRow))
          : h("p", { class: "muted" }, "此方向暫無班次。"));
      }
    }
    return h("section", { class: "line-block" }, parts);
  });
  showPanel(panelFrame(
    station.properties.name_zh,
    `${station.properties.name_en} · ${names}`,
    blocks,
    () => openStation(station),
  ));
}

const SCHEDULE_TIMEOUT_MS = 8000;

function readBody(response, signal) {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new DOMException("The operation was aborted.", "AbortError"));
    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener("abort", fail, { once: true });
    response.json().then(resolve, reject);
  });
}

async function fetchLine(line, code) {
  const url = `https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=${encodeURIComponent(line)}&sta=${encodeURIComponent(code)}&lang=TC`;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), SCHEDULE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: deadline.signal });
    if (!response.ok) return { line, error: httpFailure(response.status), schedule: null };
    const payload = await readBody(response, deadline.signal);
    return { line, error: null, schedule: normalizeSchedule(payload, line, code, state.namesByCode) };
  } catch {
    return { line, error: "暫時未能連接港鐵班次服務，請稍後再按重新整理。", schedule: null };
  } finally {
    clearTimeout(timer);
  }
}

function canonicalStation(feature) {
  const code = feature?.properties?.code;
  return state.stations.find((item) => item.properties.code === code) || feature;
}

function canonicalCamera(feature) {
  const key = feature?.properties?.key;
  return state.cameras.find((item) => item.properties.key === key) || feature;
}

async function openStation(station) {
  const source = state.map?.getSource("highlight");
  if (!source) return;
  const requestId = ++state.requestId;
  source.setData(station);
  const names = station.properties.lines.map((code) => LINE_BY_CODE[code]?.name).filter(Boolean).join("、");
  showPanel(panelFrame(
    station.properties.name_zh,
    `${station.properties.name_en} · ${names}`,
    [h("p", { class: "message" }, "正在查詢到站班次…")],
    () => openStation(station),
  ));
  const results = await Promise.all(station.properties.lines.map((line) => fetchLine(line, station.properties.code)));
  if (requestId !== state.requestId) return;
  renderSchedule(station, results);
}

function cameraImageUrl(url) {
  const token = Math.floor(Date.now() / 120000);
  return `${url}${url.includes("?") ? "&" : "?"}t=${token}`;
}

function openCamera(feature) {
  state.requestId += 1;
  const props = feature.properties;
  state.map.getSource("highlight").setData(feature);
  const photo = h("img", {
    alt: `${props.description}的最新交通快拍`,
    src: cameraImageUrl(props.url),
  });
  const missing = h("p", { class: "message", hidden: true }, "暫時未能取得此快拍點的照片。地點資料仍然有效，請稍後再試。");
  const pending = h("p", { class: "muted" }, "正在載入照片…");
  photo.addEventListener("load", () => {
    pending.remove();
    missing.hidden = true;
  });
  photo.addEventListener("error", () => {
    pending.remove();
    photo.remove();
    missing.hidden = false;
  });
  const place = [props.region, props.district].filter(Boolean).join(" · ");
  showPanel(panelFrame(props.description || "交通快拍", `${place} · 編號 ${props.key}`, [
    pending,
    photo,
    missing,
    h("p", { class: "muted" }, "照片約每兩分鐘更新。若照片寫著「暫時未能提供服務」，代表此攝錄點暫停。"),
  ]));
}

function focusStation(station) {
  state.map.flyTo({
    center: station.geometry.coordinates,
    zoom: Math.max(state.map.getZoom(), 14),
    essential: true,
  });
  openStation(station);
}

function installSearch() {
  for (const station of state.stations) {
    const option = document.createElement("option");
    option.value = station.properties.name_zh;
    option.label = station.properties.name_en;
    stationList.append(option);
  }
  searchInput.disabled = false;
  searchForm.querySelector("button[type=submit]").disabled = false;
  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!state.map?.getSource("highlight")) return;
    const hits = stationByQuery(searchInput.value);
    if (hits.length === 1) {
      focusStation(hits[0]);
      return;
    }
    const exact = hits.find((station) => foldStationText(station.properties.name_zh) === foldStationText(searchInput.value));
    if (exact) {
      focusStation(exact);
      return;
    }
    state.requestId += 1;
    if (!hits.length) {
      showPanel(panelFrame("找不到車站", "", [
        h("p", { class: "message" }, "沒有符合的港鐵站。請輸入站名，例如金鐘或中環。"),
      ]));
      return;
    }
    showPanel(panelFrame("搜尋結果", `找到 ${hits.length} 個車站`, [
      h("ul", { class: "results" }, hits.slice(0, 12).map((station) => h("li", {}, [
        h("button", { type: "button", onClick: () => focusStation(station) }, station.properties.name_zh),
      ]))),
    ]));
  });
}

function hitsAt(point) {
  const box = [
    [point.x - 8, point.y - 8],
    [point.x + 8, point.y + 8],
  ];
  const stations = state.map.queryRenderedFeatures(box, { layers: ["stations"] });
  if (stations.length) return { kind: "station", feature: stations[0] };
  if (state.map.getZoom() >= CAMERA_ZOOM) {
    const cameras = state.map.queryRenderedFeatures(box, { layers: ["cameras"] });
    if (cameras.length) return { kind: "camera", feature: cameras[0] };
  }
  return null;
}

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(path);
  return response.json();
}

async function main() {
  renderLegend();
  const [stations, lines, cameras, meta] = await Promise.all([
    loadJson("/data/stations.geojson"),
    loadJson("/data/lines.geojson"),
    loadJson("/data/cameras.geojson"),
    loadJson("/data/meta.json"),
  ]);
  state.stations = stations.features;
  state.cameras = cameras.features;
  for (const feature of stations.features) {
    state.namesByCode[feature.properties.code] = feature.properties.name_zh;
  }
  if (meta.cameraListModified) {
    sourceNote.textContent = `快拍位置表更新於${formatListDate(meta.cameraListModified)}，照片在點選時即時讀取。`;
  }

  const map = new Map({
    container: "map",
    style: "https://tiles.openfreemap.org/styles/liberty",
    center: [114.15, 22.34],
    zoom: 10.4,
    minZoom: 9,
    maxZoom: 16,
    maxBounds: [[113.45, 21.95], [114.55, 22.68]],
    attributionControl: true,
  });
  state.map = map;
  window.__map = map;
  map.addControl(new NavigationControl({ showCompass: false }), "top-right");
  map.on("zoom", updateHint);
  updateHint();

  map.on("load", () => {
    map.addSource("mtr-lines", { type: "geojson", data: lines });
    map.addSource("stations", { type: "geojson", data: stations });
    map.addSource("cameras", { type: "geojson", data: cameras });
    map.addSource("highlight", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    installSearch();

    map.addLayer({
      id: "line-casing",
      type: "line",
      source: "mtr-lines",
      paint: {
        "line-color": "#ffffff",
        "line-width": ["interpolate", ["linear"], ["zoom"], 9, 3.5, 13, 7, 16, 10],
        "line-opacity": 0.9,
      },
      layout: { "line-cap": "round", "line-join": "round" },
    });
    map.addLayer({
      id: "lines",
      type: "line",
      source: "mtr-lines",
      paint: {
        "line-color": lineColorExpression(),
        "line-width": ["interpolate", ["linear"], ["zoom"], 9, 2, 13, 4.5, 16, 7],
        "line-opacity": 0.95,
      },
      layout: { "line-cap": "round", "line-join": "round" },
    });
    map.addLayer({
      id: "cameras",
      type: "circle",
      source: "cameras",
      minzoom: CAMERA_ZOOM,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 4, 16, 7],
        "circle-color": "#c2410c",
        "circle-stroke-color": "#fff7ed",
        "circle-stroke-width": 1.5,
      },
    });
    map.addLayer({
      id: "stations",
      type: "circle",
      source: "stations",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 5, 14, 8],
        "circle-color": stationColorExpression(),
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": ["case", [">", ["length", ["get", "lines"]], 1], 3, 1.5],
      },
    });
    map.addLayer({
      id: "highlight",
      type: "circle",
      source: "highlight",
      paint: {
        "circle-radius": 14,
        "circle-color": "rgba(15, 23, 42, 0.15)",
        "circle-stroke-color": "#0f172a",
        "circle-stroke-width": 2,
      },
    });
    map.addLayer({
      id: "station-labels",
      type: "symbol",
      source: "stations",
      minzoom: 12,
      layout: {
        "text-field": ["get", "name_zh"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 13,
        "text-offset": [0, 1.1],
        "text-anchor": "top",
        "text-optional": true,
      },
      paint: {
        "text-color": "#1c1917",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.4,
      },
    });
    state.layersReady = true;
    applyLineFilter();

    map.on("click", (event) => {
      const hit = hitsAt(event.point);
      if (!hit) {
        closePanel();
        return;
      }
      if (hit.kind === "station") openStation(canonicalStation(hit.feature));
      else openCamera(canonicalCamera(hit.feature));
    });
    map.on("mousemove", (event) => {
      const hit = hitsAt(event.point);
      map.getCanvas().style.cursor = hit ? "pointer" : "";
    });
    window.__ready = true;
  });
}

main().catch((error) => {
  console.error(error);
  showPanel(panelFrame("地圖資料未能載入", "", [
    h("p", { class: "message" }, "暫時未能讀取本機的港鐵或快拍位置資料。請重新整理頁面。"),
  ]));
});
