import test from "node:test";
import assert from "node:assert/strict";
import { foldStationText, matchesStation } from "../src/search.js";

test("Lai King matches the official 荔景 spelling", () => {
  const lak = { code: "LAK", name_zh: "茘景", name_en: "Lai King" };
  assert.equal(foldStationText("荔景"), foldStationText("茘景"));
  assert.equal(matchesStation(lak, "荔景"), true);
  assert.equal(matchesStation(lak, "茘景"), true);
  assert.equal(matchesStation(lak, "lai king"), true);
  assert.equal(matchesStation(lak, "lak"), true);
  assert.equal(matchesStation(lak, "金鐘"), false);
});
