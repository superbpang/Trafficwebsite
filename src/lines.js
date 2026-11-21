export const LINES = [
  { code: "AEL", name: "機場快綫", color: "#00888a" },
  { code: "TCL", name: "東涌綫", color: "#f7943e" },
  { code: "TML", name: "屯馬綫", color: "#923011" },
  { code: "TKL", name: "將軍澳綫", color: "#7d499d" },
  { code: "EAL", name: "東鐵綫", color: "#53b7e8" },
  { code: "SIL", name: "南港島綫", color: "#b6bd00" },
  { code: "TWL", name: "荃灣綫", color: "#ed1d24" },
  { code: "ISL", name: "港島綫", color: "#007dc5" },
  { code: "KTL", name: "觀塘綫", color: "#00ab4e" },
  { code: "DRL", name: "迪士尼綫", color: "#f173ac" },
];

export const LINE_BY_CODE = Object.fromEntries(LINES.map((line) => [line.code, line]));

export function lineColorExpression() {
  const expression = ["match", ["get", "code"]];
  for (const line of LINES) {
    expression.push(line.code, line.color);
  }
  expression.push("#334155");
  return expression;
}

export function stationColorExpression() {
  const expression = ["match", ["at", 0, ["get", "lines"]]];
  for (const line of LINES) {
    expression.push(line.code, line.color);
  }
  expression.push("#334155");
  return expression;
}
