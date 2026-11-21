import test from "node:test";
import assert from "node:assert/strict";
import { clockLabel, httpFailure, minutesLabel, normalizeSchedule } from "../src/schedule.js";

const names = { CHW: "柴灣", KET: "堅尼地城", SUN: "欣澳" };

test("minutes come from Hong Kong timestamps, not the dummy ttnt field", () => {
  assert.equal(minutesLabel("2026-11-21 10:27:56", "2026-11-21 10:25:56"), "2 分鐘");
  assert.equal(minutesLabel("01:17:00", "01:10:42"), "6 分鐘");
  assert.equal(minutesLabel("2026-11-21 10:26:20", "2026-11-21 10:25:56"), "即將到站");
  assert.equal(minutesLabel("2026-11-22 00:02:00", "2026-11-21 23:58:00"), "4 分鐘");
  assert.equal(minutesLabel("-", "2026-11-21 10:25:56"), "");
  assert.equal(clockLabel("2026-11-21 10:27:56"), "10:27");
});

test("live trains keep destination, platform and time", () => {
  const result = normalizeSchedule({
    status: 1,
    isdelay: "N",
    curr_time: "2026-11-21 10:25:56",
    data: {
      "ISL-CEN": {
        UP: [{ dest: "CHW", plat: "3", time: "2026-11-21 10:27:56", ttnt: "9", valid: "Y" }],
        DOWN: [{ dest: "KET", plat: "4", time: "2026-11-21 10:26:10", ttnt: "0", valid: "N" }],
      },
    },
  }, "ISL", "CEN", names);
  assert.equal(result.status, "ok");
  assert.equal(result.directions[0].trains[0].destName, "柴灣");
  assert.equal(result.directions[0].trains[0].minutesLabel, "2 分鐘");
  assert.equal(result.directions[0].trains[0].platform, "3");
  assert.equal(result.directions[1].trains[0].minutesLabel, "即將到站");
  assert.equal(result.directions[1].trains[0].uncertain, true);
});

test("racecourse with empty arrays explains there is no train", () => {
  const result = normalizeSchedule({
    status: 1,
    isdelay: "N",
    curr_time: "2026-11-21 10:38:10",
    data: { "EAL-RAC": { UP: [], DOWN: [] } },
  }, "EAL", "RAC", names);
  assert.equal(result.status, "empty");
  assert.match(result.notice, /賽馬日/);
});

test("wrong station combination is an empty schedule, not a crash", () => {
  const result = normalizeSchedule({
    status: 0,
    message: "The contents are empty!",
  }, "ISL", "AIR", names);
  assert.equal(result.status, "empty");
  assert.match(result.notice, /暫無到站班次/);
});

test("a missing direction still leaves the other direction intact", () => {
  const result = normalizeSchedule({
    status: 1,
    data: { "DRL-DIS": { UP: [{ dest: "SUN", plat: "1", time: "2026-11-21 10:30:37", ttnt: "4", valid: "Y" }] } },
  }, "DRL", "DIS", names);
  assert.equal(result.directions[0].trains[0].destName, "欣澳");
  assert.equal(result.directions[1].trains.length, 0);
});

test("a suspension message is shown instead of a generic empty notice", () => {
  const result = normalizeSchedule({
    status: 0,
    message: "LOW station is suspended",
  }, "TCL", "LOW", names);
  assert.equal(result.status, "empty");
  assert.equal(result.notice, "LOW station is suspended");
});

test("http failures have their own wording", () => {
  assert.match(httpFailure(429), /頻繁/);
  assert.match(httpFailure(500), /暫時未能/);
});
