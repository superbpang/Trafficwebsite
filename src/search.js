export function foldStationText(value) {
  return String(value ?? "").trim().toLowerCase().replaceAll("茘", "荔");
}

export function matchesStation(props, query) {
  const text = foldStationText(query);
  if (!text) return false;
  return foldStationText(props?.name_zh).includes(text)
    || String(props?.name_en ?? "").toLowerCase().includes(text)
    || String(props?.code ?? "").toLowerCase() === text;
}
