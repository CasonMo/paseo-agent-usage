"use strict";

// server/remote/collector.ts
var import_node_os7 = require("os");
var import_node_path9 = require("path");

// server/scan/scanner.ts
var import_promises4 = require("fs/promises");

// server/scan/claude.ts
var import_node_os = require("os");
var import_node_path3 = require("path");

// server/scan/state.ts
var import_promises2 = require("fs/promises");
var import_node_path2 = require("path");

// server/scan/util.ts
var import_promises = require("fs/promises");
var import_node_path = require("path");
function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function clipTitle(text) {
  if (typeof text !== "string") return "";
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const chars = [...clean];
  return chars.length > 60 ? `${chars.slice(0, 60).join("")}\u2026` : clean;
}
var MACHINE_LABEL = /^(# AGENTS\.md|<environment_context|<user_instructions|<permissions|<chat-history-summary|<paseo-system|<paseo-agent|this session is being continued|caveat: the messages below)/i;
function firstMessageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  for (const block of content) {
    if (block && typeof block === "object" && typeof block.text === "string") {
      const kind = block.type;
      if (kind === "text" || kind === "input_text") return block.text;
    }
  }
  return "";
}
function localDateKey(ms) {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
function localHourKey(ms) {
  const date = new Date(ms);
  return `${localDateKey(ms)}T${String(date.getHours()).padStart(2, "0")}`;
}
async function listJsonlFiles(root) {
  const files = [];
  const queue = [root];
  while (queue.length > 0) {
    const dir = queue.pop();
    let entries;
    try {
      entries = await (0, import_promises.readdir)(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) queue.push((0, import_node_path.join)(dir, entry.name));
      else if (entry.name.endsWith(".jsonl")) files.push((0, import_node_path.join)(dir, entry.name));
    }
  }
  return files;
}
var CHUNK = 4 * 1024 * 1024;
async function forEachNewLine(path, fromOffset, onLine) {
  let handle;
  try {
    handle = await (0, import_promises.open)(path, "r");
  } catch {
    return null;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) return null;
    let pos = fromOffset > info.size ? 0 : fromOffset;
    let carry = Buffer.alloc(0);
    const buffer = Buffer.allocUnsafe(CHUNK);
    while (pos < info.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(CHUNK, info.size - pos), pos);
      if (bytesRead <= 0) break;
      pos += bytesRead;
      const view = carry.length > 0 ? Buffer.concat([carry, buffer.subarray(0, bytesRead)]) : buffer.subarray(0, bytesRead);
      let start = 0;
      let newline = -1;
      while ((newline = view.indexOf(10, start)) !== -1) {
        onLine(view.subarray(start, newline).toString("utf8"));
        start = newline + 1;
      }
      carry = Buffer.from(view.subarray(start));
    }
    return { offset: pos - carry.length, size: info.size, mtimeMs: info.mtimeMs };
  } finally {
    await handle.close();
  }
}

// server/scan/state.ts
var STATE_VERSION = 13;
var DEFAULT_ARCHIVE_RETENTION_DAYS = 0;
var SESSION_KEEP_LIMIT = 8e3;
function pruneSessions(sessions) {
  for (const key of Object.keys(sessions)) {
    const entry = sessions[key];
    if (!entry || entry.r <= 0) delete sessions[key];
  }
  const keys = Object.keys(sessions);
  if (keys.length <= SESSION_KEEP_LIMIT) return;
  keys.sort((a, b) => {
    var _a, _b;
    return (((_a = sessions[b]) == null ? void 0 : _a.e) ?? 0) - (((_b = sessions[a]) == null ? void 0 : _b.e) ?? 0);
  });
  for (const key of keys.slice(SESSION_KEEP_LIMIT)) delete sessions[key];
}
function applyModelTuple(map, model, i, o, cr, cw) {
  if (!model || i === 0 && o === 0 && cr === 0 && cw === 0) return map;
  const nextMap = map ?? {};
  const prev = nextMap[model] ?? [0, 0, 0, 0];
  const next = [prev[0] + i, prev[1] + o, prev[2] + cr, prev[3] + cw];
  if (next[0] <= 0 && next[1] <= 0 && next[2] <= 0 && next[3] <= 0) {
    delete nextMap[model];
    return Object.keys(nextMap).length > 0 ? nextMap : void 0;
  }
  nextMap[model] = next;
  return nextMap;
}
function seedLegacySessionBilled(entry) {
  if (entry.cost <= 0 || entry.bt !== void 0 || !entry.models) return;
  const bt = {};
  for (const [model, tuple] of Object.entries(entry.models)) {
    bt[model] = [tuple[0], tuple[1], tuple[2], tuple[3]];
  }
  if (Object.keys(bt).length > 0) entry.bt = bt;
}
function applySession(sessions, harness, sid, delta) {
  if (!sid) return;
  const key = `${harness}${sid}`;
  let entry = sessions[key];
  const isNew = !entry;
  if (!entry) {
    if (delta.r <= 0) return;
    entry = { s: delta.t ?? 0, e: delta.t ?? 0, r: 0, i: 0, o: 0, cr: 0, cw: 0, rz: 0, cost: 0, credits: 0, p: delta.p ?? "" };
    sessions[key] = entry;
  } else if (delta.r > 0 && entry.cost > 0 && entry.bt === void 0) {
    seedLegacySessionBilled(entry);
  }
  const di = delta.i ?? 0;
  const do_ = delta.o ?? 0;
  const dcr = delta.cr ?? 0;
  const dcw = delta.cw ?? 0;
  const dcost = delta.cost ?? 0;
  entry.r += delta.r;
  entry.i += di;
  entry.o += do_;
  entry.cr += dcr;
  entry.cw += dcw;
  entry.rz += delta.rz ?? 0;
  entry.cost += dcost;
  entry.credits += delta.credits ?? 0;
  entry.models = applyModelTuple(entry.models, delta.model, di, do_, dcr, dcw);
  if (!isNew && entry.bt !== void 0) {
    if (dcost > 0) entry.bt = applyModelTuple(entry.bt, delta.model, di, do_, dcr, dcw);
  } else if (dcost > 0) {
    entry.bt = applyModelTuple(entry.bt, delta.model, di, do_, dcr, dcw);
  }
  if (entry.cost <= 0 && entry.bt) delete entry.bt;
  if (delta.p) entry.p = delta.p;
  if (delta.title && !entry.title) entry.title = delta.title;
  if (typeof delta.t === "number" && Number.isFinite(delta.t)) {
    if (entry.s === 0 || delta.t < entry.s) entry.s = delta.t;
    if (delta.t > entry.e) entry.e = delta.t;
  }
}
var MAX_RECENT_PER_AGENT = 400;
function emptyState() {
  return {
    version: STATE_VERSION,
    buckets: {},
    sessions: {},
    files: {},
    recent: {},
    opencode: { watermark: 0, lastId: "" },
    pi: { seen: [] },
    hosts: {},
    meta: { lastScanAt: null, scanError: null }
  };
}
function bucketKey(hourKey, harness, model, project) {
  return [hourKey, harness, model, project].join("");
}
function addTokenTuple(target, delta) {
  const next = [
    ((target == null ? void 0 : target[0]) ?? 0) + delta[0],
    ((target == null ? void 0 : target[1]) ?? 0) + delta[1],
    ((target == null ? void 0 : target[2]) ?? 0) + delta[2],
    ((target == null ? void 0 : target[3]) ?? 0) + delta[3]
  ];
  if (next[0] <= 0 && next[1] <= 0 && next[2] <= 0 && next[3] <= 0) return void 0;
  return next;
}
function addBucketByKey(buckets, key, delta) {
  let bucket = buckets[key];
  const isNew = !bucket;
  if (!bucket) {
    bucket = { r: 0, i: 0, o: 0, cr: 0, cw: 0, rz: 0, cost: 0, credits: 0 };
    buckets[key] = bucket;
  } else if (bucket.bt === void 0 && bucket.cost > 0 && ((delta.cost ?? 0) > 0 || delta.bt !== void 0 || delta.r > 0)) {
    bucket.bt = [bucket.i, bucket.o, bucket.cr, bucket.cw];
  }
  const di = delta.i ?? 0;
  const do_ = delta.o ?? 0;
  const dcr = delta.cr ?? 0;
  const dcw = delta.cw ?? 0;
  const dcost = delta.cost ?? 0;
  bucket.r += delta.r;
  bucket.i += di;
  bucket.o += do_;
  bucket.cr += dcr;
  bucket.cw += dcw;
  bucket.rz += delta.rz ?? 0;
  bucket.cost += dcost;
  bucket.credits += delta.credits ?? 0;
  if (delta.bt !== void 0) {
    const nextBt = addTokenTuple(bucket.bt, delta.bt);
    if (nextBt) bucket.bt = nextBt;
    else delete bucket.bt;
  } else if (dcost > 0) {
    const nextBt = addTokenTuple(bucket.bt, [di, do_, dcr, dcw]);
    if (nextBt) bucket.bt = nextBt;
    else delete bucket.bt;
  } else if (isNew && bucket.bt) {
    delete bucket.bt;
  }
  if (bucket.cost <= 0 && bucket.bt) delete bucket.bt;
  if (bucket.r <= 0 && bucket.i <= 0 && bucket.o <= 0 && bucket.cr <= 0 && bucket.cw <= 0 && bucket.rz <= 0 && bucket.cost <= 0 && bucket.credits <= 0) {
    delete buckets[key];
  }
}
function addBucket(buckets, hourKey, harness, model, project, delta) {
  addBucketByKey(buckets, bucketKey(hourKey, harness, model, project), delta);
}
function recordFileBucket(state, fileBuckets, hourKey, harness, model, project, delta) {
  addBucket(state.buckets, hourKey, harness, model, project, delta);
  addBucket(fileBuckets, hourKey, harness, model, project, delta);
}
function recordFileSession(state, fileSessions, harness, sid, delta) {
  applySession(state.sessions, harness, sid, delta);
  applySession(fileSessions, harness, sid, delta);
}
function mergeSessionEntry(sessions, key, entry, sign = 1) {
  let target = sessions[key];
  if (!target) {
    if (sign < 0 || entry.r <= 0) return;
    target = { s: entry.s, e: entry.e, r: 0, i: 0, o: 0, cr: 0, cw: 0, rz: 0, cost: 0, credits: 0, p: entry.p };
    sessions[key] = target;
  } else if (sign > 0 && target.cost > 0 && target.bt === void 0 && entry.bt !== void 0) {
    seedLegacySessionBilled(target);
  }
  target.r += sign * entry.r;
  target.i += sign * entry.i;
  target.o += sign * entry.o;
  target.cr += sign * entry.cr;
  target.cw += sign * entry.cw;
  target.rz += sign * entry.rz;
  target.cost += sign * entry.cost;
  target.credits += sign * entry.credits;
  if (entry.models) {
    for (const [model, tuple] of Object.entries(entry.models)) {
      target.models = applyModelTuple(target.models, model, sign * tuple[0], sign * tuple[1], sign * tuple[2], sign * tuple[3]);
    }
  }
  if (entry.bt) {
    for (const [model, tuple] of Object.entries(entry.bt)) {
      target.bt = applyModelTuple(target.bt, model, sign * tuple[0], sign * tuple[1], sign * tuple[2], sign * tuple[3]);
    }
  } else if (sign > 0 && entry.cost > 0 && entry.models && target.bt !== void 0) {
    for (const [model, tuple] of Object.entries(entry.models)) {
      target.bt = applyModelTuple(target.bt, model, tuple[0], tuple[1], tuple[2], tuple[3]);
    }
  }
  if (target.cost <= 0 && target.bt) delete target.bt;
  if (sign > 0) {
    if (entry.p && !target.p) target.p = entry.p;
    if (entry.title && !target.title) target.title = entry.title;
    if (entry.s > 0 && (target.s === 0 || entry.s < target.s)) target.s = entry.s;
    if (entry.e > target.e) target.e = entry.e;
  }
  if (target.r <= 0 && target.i <= 0 && target.o <= 0 && target.cr <= 0 && target.cw <= 0) {
    delete sessions[key];
  }
}
function mergeBuckets(target, source, sign = 1) {
  if (!source) return;
  for (const [key, bucket] of Object.entries(source)) {
    const existing = target[key];
    const bt = bucket.bt ? [sign * bucket.bt[0], sign * bucket.bt[1], sign * bucket.bt[2], sign * bucket.bt[3]] : sign > 0 && bucket.cost > 0 && (existing == null ? void 0 : existing.bt) !== void 0 ? [bucket.i, bucket.o, bucket.cr, bucket.cw] : void 0;
    addBucketByKey(target, key, {
      r: sign * bucket.r,
      i: sign * bucket.i,
      o: sign * bucket.o,
      cr: sign * bucket.cr,
      cw: sign * bucket.cw,
      rz: sign * bucket.rz,
      cost: sign * bucket.cost,
      credits: sign * bucket.credits,
      ...bt !== void 0 ? { bt } : {}
    });
  }
}
function dropRecentForFile(state, filePath) {
  if (!filePath) return;
  for (const [harness, list] of Object.entries(state.recent)) {
    if (!Array.isArray(list) || list.length === 0) continue;
    const filtered = list.filter((record) => record.f !== filePath);
    if (filtered.length !== list.length) state.recent[harness] = filtered;
  }
}
function archiveFileContribution(state, fileState, filePath) {
  var _a;
  const hasBuckets = Boolean(fileState.buckets && Object.keys(fileState.buckets).length > 0);
  const hasSessions = Boolean(fileState.sessions && Object.keys(fileState.sessions).length > 0);
  if (!hasBuckets && !hasSessions) return;
  state.archive ?? (state.archive = { buckets: {}, sessions: {} });
  mergeBuckets(state.archive.buckets, fileState.buckets, 1);
  if (fileState.sessions) {
    for (const [key, entry] of Object.entries(fileState.sessions)) {
      mergeSessionEntry(state.archive.sessions, key, entry, 1);
    }
  }
  if (filePath) {
    (_a = state.archive).files ?? (_a.files = {});
    const snapshot = {};
    if (hasBuckets) snapshot.buckets = sanitizeBuckets(fileState.buckets);
    if (hasSessions) snapshot.sessions = sanitizeSessions(fileState.sessions);
    if (fileState.ledgerFrom0) snapshot.ledgerFrom0 = true;
    state.archive.files[filePath] = snapshot;
  }
}
function revokeFileContribution(state, fileState, filePath) {
  mergeBuckets(state.buckets, fileState.buckets, -1);
  if (fileState.sessions) {
    for (const [key, entry] of Object.entries(fileState.sessions)) {
      mergeSessionEntry(state.sessions, key, entry, -1);
    }
  }
  dropRecentForFile(state, filePath);
}
function revokeArchivedFile(state, filePath) {
  var _a, _b;
  const archived = (_b = (_a = state.archive) == null ? void 0 : _a.files) == null ? void 0 : _b[filePath];
  if (!archived || !state.archive) return "none";
  delete state.archive.files[filePath];
  if (state.archive.files && Object.keys(state.archive.files).length === 0) delete state.archive.files;
  mergeBuckets(state.archive.buckets, archived.buckets, -1);
  if (archived.sessions) {
    for (const [key, entry] of Object.entries(archived.sessions)) {
      mergeSessionEntry(state.archive.sessions, key, entry, -1);
    }
  }
  if (Object.keys(state.archive.buckets).length === 0 && Object.keys(state.archive.sessions).length === 0) {
    delete state.archive;
  }
  if (!archived.ledgerFrom0) return "legacy_reset";
  mergeBuckets(state.buckets, archived.buckets, -1);
  if (archived.sessions) {
    for (const [key, entry] of Object.entries(archived.sessions)) {
      mergeSessionEntry(state.sessions, key, entry, -1);
    }
  }
  dropRecentForFile(state, filePath);
  return "revoked";
}
function pruneArchivedHistory(state, retentionDays = DEFAULT_ARCHIVE_RETENTION_DAYS, now = Date.now()) {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return;
  const cutoffMs = now - retentionDays * 864e5;
  const cutoffHour = localHourKey(cutoffMs);
  if (state.archive) {
    for (const [key, bucket] of Object.entries(state.archive.buckets)) {
      const hour = key.split("", 1)[0] ?? "";
      if (hour && hour < cutoffHour) {
        addBucketByKey(state.buckets, key, {
          r: -bucket.r,
          i: -bucket.i,
          o: -bucket.o,
          cr: -bucket.cr,
          cw: -bucket.cw,
          rz: -bucket.rz,
          cost: -bucket.cost,
          credits: -bucket.credits,
          ...bucket.bt ? { bt: [-bucket.bt[0], -bucket.bt[1], -bucket.bt[2], -bucket.bt[3]] } : {}
        });
        delete state.archive.buckets[key];
        if (state.archive.files) {
          for (const fileEntry of Object.values(state.archive.files)) {
            if (fileEntry.buckets) delete fileEntry.buckets[key];
          }
        }
      }
    }
    for (const [key, entry] of Object.entries(state.archive.sessions)) {
      if (entry.e > 0 && entry.e < cutoffMs) {
        mergeSessionEntry(state.sessions, key, entry, -1);
        delete state.archive.sessions[key];
        if (state.archive.files) {
          for (const fileEntry of Object.values(state.archive.files)) {
            if (fileEntry.sessions) delete fileEntry.sessions[key];
          }
        }
      }
    }
    if (state.archive.files) {
      for (const [filePath, fileEntry] of Object.entries(state.archive.files)) {
        if (fileEntry.buckets && Object.keys(fileEntry.buckets).length === 0) delete fileEntry.buckets;
        if (fileEntry.sessions && Object.keys(fileEntry.sessions).length === 0) delete fileEntry.sessions;
        if (!fileEntry.buckets && !fileEntry.sessions) delete state.archive.files[filePath];
      }
      if (Object.keys(state.archive.files).length === 0) delete state.archive.files;
    }
    if (Object.keys(state.archive.buckets).length === 0 && Object.keys(state.archive.sessions).length === 0) {
      delete state.archive;
    }
  }
  if (state.agy) {
    for (const [sid, conv] of Object.entries(state.agy)) {
      if (!conv.archived) continue;
      let latestHour = "";
      for (const key of Object.keys(conv.buckets)) {
        const hour = key.split("", 1)[0] ?? "";
        if (hour > latestHour) latestHour = hour;
      }
      const sessionExpired = conv.session ? conv.session.e > 0 && conv.session.e < cutoffMs : true;
      const bucketsExpired = !latestHour || latestHour < cutoffHour;
      if (sessionExpired && bucketsExpired) {
        mergeBuckets(state.buckets, conv.buckets, -1);
        if (conv.session) mergeSessionEntry(state.sessions, `agy${sid}`, conv.session, -1);
        delete state.agy[sid];
      }
    }
    if (Object.keys(state.agy).length === 0) delete state.agy;
  }
}
function recordCall(state, harness, record, replaceId) {
  var _a;
  let list = state.recent[harness];
  if (!list) {
    list = [];
    state.recent[harness] = list;
  }
  if (replaceId) {
    const floor = Math.max(0, list.length - 32);
    for (let index = list.length - 1; index >= floor; index -= 1) {
      if (((_a = list[index]) == null ? void 0 : _a.id) === replaceId) {
        list[index] = record;
        return;
      }
    }
  }
  list.push(record);
  if (list.length > MAX_RECENT_PER_AGENT) list.splice(0, list.length - MAX_RECENT_PER_AGENT);
}
function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function sanitizeTokenTuple(raw) {
  if (!Array.isArray(raw) || raw.length < 4) return void 0;
  const entry = [finite(raw[0]), finite(raw[1]), finite(raw[2]), finite(raw[3])];
  return entry[0] > 0 || entry[1] > 0 || entry[2] > 0 || entry[3] > 0 ? entry : void 0;
}
function sanitizeBuckets(raw) {
  const buckets = {};
  if (!raw || typeof raw !== "object") return buckets;
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") continue;
    const record = value;
    const bucket = {
      r: finite(record.r),
      i: finite(record.i),
      o: finite(record.o),
      cr: finite(record.cr),
      cw: finite(record.cw),
      rz: finite(record.rz),
      cost: finite(record.cost),
      credits: finite(record.credits)
    };
    const bt = sanitizeTokenTuple(record.bt);
    if (bt && bucket.cost > 0) bucket.bt = bt;
    buckets[key] = bucket;
  }
  return buckets;
}
function sanitizeSessionModels(raw) {
  if (!raw || typeof raw !== "object") return void 0;
  const models = {};
  for (const [model, tuple] of Object.entries(raw)) {
    if (!model) continue;
    const entry = sanitizeTokenTuple(tuple);
    if (entry) models[model] = entry;
  }
  return Object.keys(models).length > 0 ? models : void 0;
}
function sanitizeSessions(raw) {
  const sessions = {};
  if (!raw || typeof raw !== "object") return sessions;
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") continue;
    const record = value;
    const models = sanitizeSessionModels(record.models);
    const bt = sanitizeSessionModels(record.bt);
    const entry = {
      s: finite(record.s),
      e: finite(record.e),
      r: finite(record.r),
      i: finite(record.i),
      o: finite(record.o),
      cr: finite(record.cr),
      cw: finite(record.cw),
      rz: finite(record.rz),
      cost: finite(record.cost),
      credits: finite(record.credits),
      p: typeof record.p === "string" ? record.p : ""
    };
    if (typeof record.title === "string") entry.title = record.title;
    if (models) entry.models = models;
    if (bt && entry.cost > 0) entry.bt = bt;
    sessions[key] = entry;
  }
  return sessions;
}
function sanitizeArchiveFiles(raw) {
  if (!raw || typeof raw !== "object") return void 0;
  const files = {};
  for (const [filePath, value] of Object.entries(raw)) {
    if (!filePath || !value || typeof value !== "object") continue;
    const record = value;
    const buckets = record.buckets ? sanitizeBuckets(record.buckets) : void 0;
    const sessions = record.sessions ? sanitizeSessions(record.sessions) : void 0;
    const hasBuckets = Boolean(buckets && Object.keys(buckets).length > 0);
    const hasSessions = Boolean(sessions && Object.keys(sessions).length > 0);
    if (!hasBuckets && !hasSessions) continue;
    const entry = {};
    if (hasBuckets) entry.buckets = buckets;
    if (hasSessions) entry.sessions = sessions;
    if (record.ledgerFrom0 === true) entry.ledgerFrom0 = true;
    files[filePath] = entry;
  }
  return Object.keys(files).length > 0 ? files : void 0;
}
function sanitizeAgyArchive(raw) {
  if (!raw || typeof raw !== "object") return void 0;
  const out = {};
  for (const [sid, value] of Object.entries(raw)) {
    if (!sid || !value || typeof value !== "object") continue;
    const record = value;
    const buckets = sanitizeBuckets(record.buckets);
    const sessionMap = record.session ? sanitizeSessions({ s: record.session }) : {};
    const session = sessionMap.s;
    const keys = Array.isArray(record.keys) ? record.keys.filter((item) => typeof item === "string") : void 0;
    if (Object.keys(buckets).length > 0 || session) {
      const entry = session ? { buckets, session } : { buckets };
      if (keys && keys.length > 0) entry.keys = keys;
      if (record.archived === true) entry.archived = true;
      out[sid] = entry;
    }
  }
  return Object.keys(out).length > 0 ? out : void 0;
}
async function loadState(dir) {
  var _a, _b, _c, _d, _e, _f, _g, _h;
  try {
    const text = await (0, import_promises2.readFile)((0, import_node_path2.join)(dir, "state.json"), "utf8");
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || parsed.version !== STATE_VERSION) return emptyState();
    const state = emptyState();
    state.buckets = sanitizeBuckets(parsed.buckets);
    state.sessions = sanitizeSessions(parsed.sessions);
    state.files = parsed.files ?? {};
    state.recent = parsed.recent ?? {};
    state.opencode = {
      watermark: finite((_a = parsed.opencode) == null ? void 0 : _a.watermark),
      lastId: typeof ((_b = parsed.opencode) == null ? void 0 : _b.lastId) === "string" ? parsed.opencode.lastId : "",
      legacyWatermark: typeof ((_c = parsed.opencode) == null ? void 0 : _c.legacyWatermark) === "number" ? parsed.opencode.legacyWatermark : void 0,
      legacyLastId: typeof ((_d = parsed.opencode) == null ? void 0 : _d.legacyLastId) === "string" ? parsed.opencode.legacyLastId : void 0,
      seen: Array.isArray((_e = parsed.opencode) == null ? void 0 : _e.seen) ? parsed.opencode.seen.filter((id) => typeof id === "string") : void 0
    };
    state.pi = { seen: Array.isArray((_f = parsed.pi) == null ? void 0 : _f.seen) ? parsed.pi.seen.filter((k) => typeof k === "string") : [] };
    state.hosts = parsed.hosts ?? {};
    if (parsed.archive && typeof parsed.archive === "object") {
      const archiveBuckets = sanitizeBuckets(parsed.archive.buckets);
      const archiveSessions = sanitizeSessions(parsed.archive.sessions);
      const archiveFiles = sanitizeArchiveFiles(parsed.archive.files);
      if (Object.keys(archiveBuckets).length > 0 || Object.keys(archiveSessions).length > 0) {
        state.archive = { buckets: archiveBuckets, sessions: archiveSessions, ...archiveFiles ? { files: archiveFiles } : {} };
      }
    }
    const agy = sanitizeAgyArchive(parsed.agy);
    if (agy) state.agy = agy;
    state.meta = {
      lastScanAt: typeof ((_g = parsed.meta) == null ? void 0 : _g.lastScanAt) === "number" ? parsed.meta.lastScanAt : null,
      scanError: typeof ((_h = parsed.meta) == null ? void 0 : _h.scanError) === "string" ? parsed.meta.scanError : null
    };
    return state;
  } catch {
    return emptyState();
  }
}
async function saveState(dir, state) {
  pruneSessions(state.sessions);
  for (const host of Object.values(state.hosts ?? {})) if (host == null ? void 0 : host.sessions) pruneSessions(host.sessions);
  await (0, import_promises2.mkdir)(dir, { recursive: true, mode: 448 }).catch(() => {
  });
  const file = (0, import_node_path2.join)(dir, "state.json");
  const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`;
  await (0, import_promises2.writeFile)(temporary, JSON.stringify(state), { mode: 384 });
  await (0, import_promises2.rename)(temporary, file);
  await (0, import_promises2.chmod)(dir, 448).catch(() => {
  });
}

// server/scan/claude.ts
var CLAUDE = "claude";
function claudeRoots(env = process.env) {
  var _a;
  const home = (0, import_node_os.homedir)();
  const base = ((_a = env.CLAUDE_CONFIG_DIR) == null ? void 0 : _a.trim()) || (0, import_node_path3.join)(home, ".claude");
  return [.../* @__PURE__ */ new Set([(0, import_node_path3.join)(base, "projects"), (0, import_node_path3.join)(home, ".config", "claude", "projects")])];
}
async function scanClaudeFile(state, path) {
  const previousState = state.files[path];
  const recent = /* @__PURE__ */ new Map();
  const fileBuckets = (previousState == null ? void 0 : previousState.buckets) ? { ...previousState.buckets } : {};
  const fileSessions = (previousState == null ? void 0 : previousState.sessions) ? { ...previousState.sessions } : {};
  let sessionTitle = (previousState == null ? void 0 : previousState.sessionTitle) ?? "";
  if (previousState == null ? void 0 : previousState.recent) {
    for (const contribution of previousState.recent) recent.set(contribution.id, contribution);
  }
  const result = await forEachNewLine(path, (previousState == null ? void 0 : previousState.offset) ?? 0, (line) => {
    var _a, _b;
    if (!line.includes('"sessionId"')) return;
    if (line.includes('"type":"user"')) {
      try {
        const entry2 = JSON.parse(line);
        if ((entry2 == null ? void 0 : entry2.type) === "user") {
          const raw = firstMessageText((_a = entry2.message) == null ? void 0 : _a.content);
          const text = raw && !MACHINE_LABEL.test(raw.trim()) ? clipTitle(raw) : "";
          if (text && !sessionTitle) sessionTitle = text;
          return;
        }
      } catch {
      }
    }
    if (!line.includes('"usage"') || !line.includes('"assistant"')) return;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      return;
    }
    if ((entry == null ? void 0 : entry.type) !== "assistant") return;
    const message = entry.message;
    if (!message || typeof message !== "object") return;
    const usage = message.usage;
    if (!usage || typeof usage !== "object") return;
    const ts = Date.parse(entry.timestamp);
    if (!Number.isFinite(ts)) return;
    const id = typeof message.id === "string" && message.id ? message.id : null;
    const sid = typeof entry.sessionId === "string" ? entry.sessionId : "";
    const contribution = {
      id: id ?? "",
      d: localHourKey(ts),
      m: typeof message.model === "string" && message.model ? message.model : "unknown",
      p: typeof entry.cwd === "string" ? entry.cwd : "",
      i: num(usage.input_tokens),
      o: num(usage.output_tokens),
      cr: num(usage.cache_read_input_tokens),
      cw: num(usage.cache_creation_input_tokens),
      rz: num((_b = usage.output_tokens_details) == null ? void 0 : _b.thinking_tokens)
    };
    if (id && recent.has(id)) {
      const before = recent.get(id);
      recordFileBucket(state, fileBuckets, before.d, CLAUDE, before.m, before.p, {
        r: -1,
        i: -before.i,
        o: -before.o,
        cr: -before.cr,
        cw: -before.cw,
        rz: -before.rz
      });
      recordFileSession(state, fileSessions, CLAUDE, sid, {
        r: -1,
        i: -before.i,
        o: -before.o,
        cr: -before.cr,
        cw: -before.cw,
        rz: -before.rz,
        model: before.m
      });
    }
    if (id) {
      recent.set(id, contribution);
      if (recent.size > 96) {
        const oldest = recent.keys().next().value;
        if (typeof oldest === "string" && oldest !== id) recent.delete(oldest);
      }
    }
    recordFileBucket(state, fileBuckets, contribution.d, CLAUDE, contribution.m, contribution.p, {
      r: 1,
      i: contribution.i,
      o: contribution.o,
      cr: contribution.cr,
      cw: contribution.cw,
      rz: contribution.rz
    });
    recordFileSession(state, fileSessions, CLAUDE, sid, {
      t: ts,
      r: 1,
      p: contribution.p,
      i: contribution.i,
      o: contribution.o,
      cr: contribution.cr,
      cw: contribution.cw,
      rz: contribution.rz,
      model: contribution.m,
      title: sessionTitle || void 0
    });
    recordCall(
      state,
      CLAUDE,
      {
        t: ts,
        m: contribution.m,
        p: contribution.p,
        s: sid,
        i: contribution.i,
        o: contribution.o,
        cr: contribution.cr,
        cw: contribution.cw,
        rz: contribution.rz,
        cost: 0,
        credits: 0,
        id: id ?? void 0,
        f: path
      },
      id ?? void 0
    );
  });
  if (!result) return;
  const ledgerFrom0 = !previousState || previousState.offset === 0 || Boolean(previousState.ledgerFrom0);
  const fileState = { offset: result.offset, size: result.size, mtimeMs: result.mtimeMs };
  if (ledgerFrom0) fileState.ledgerFrom0 = true;
  if (sessionTitle) fileState.sessionTitle = sessionTitle;
  if (recent.size > 0) fileState.recent = [...recent.values()].slice(-96);
  if (Object.keys(fileBuckets).length > 0) fileState.buckets = fileBuckets;
  if (Object.keys(fileSessions).length > 0) fileState.sessions = fileSessions;
  state.files[path] = fileState;
}

// server/scan/codebuddy.ts
var import_node_os2 = require("os");
var import_node_path4 = require("path");
var CODEBUDDY = "codebuddy";
var CODEBUDDY_MACHINE = /^generate a title and a git branch name for a coding agent/i;
function codebuddyRoots(env = process.env) {
  var _a;
  const home = (0, import_node_os2.homedir)();
  const base = ((_a = env.CODEBUDDY_CONFIG_DIR) == null ? void 0 : _a.trim()) || (0, import_node_path4.join)(home, ".codebuddy");
  return [.../* @__PURE__ */ new Set([(0, import_node_path4.join)(base, "projects"), (0, import_node_path4.join)(home, ".config", "codebuddy", "projects")])];
}
function toMillis(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return NaN;
    return value < 1e12 ? value * 1e3 : value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      const numeric = Number(trimmed);
      return numeric < 1e12 ? numeric * 1e3 : numeric;
    }
    return Date.parse(trimmed);
  }
  return NaN;
}
function sumDetail(value, field) {
  if (Array.isArray(value)) {
    let total = 0;
    for (const item of value) {
      if (item && typeof item === "object") total += num(item[field]);
    }
    return total;
  }
  if (value && typeof value === "object") return num(value[field]);
  return 0;
}
function sessionLabel(entry) {
  const nested = entry.message;
  const role = entry.role ?? (nested == null ? void 0 : nested.role);
  if (role !== "user") return "";
  const content = entry.content ?? (nested == null ? void 0 : nested.content);
  const raw = firstMessageText(content);
  if (!raw) return "";
  const text = raw.trim();
  if (MACHINE_LABEL.test(text) || CODEBUDDY_MACHINE.test(text)) return "";
  return clipTitle(raw);
}
async function scanCodebuddyFile(state, path) {
  const previousState = state.files[path];
  const fileBuckets = (previousState == null ? void 0 : previousState.buckets) ? { ...previousState.buckets } : {};
  const fileSessions = (previousState == null ? void 0 : previousState.sessions) ? { ...previousState.sessions } : {};
  let sessionTitle = (previousState == null ? void 0 : previousState.sessionTitle) ?? "";
  const result = await forEachNewLine(path, (previousState == null ? void 0 : previousState.offset) ?? 0, (line) => {
    if (!line.includes('"usage"') && (sessionTitle || !line.includes('"role"'))) return;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      return;
    }
    if (!sessionTitle) {
      const label = sessionLabel(entry);
      if (label) sessionTitle = label;
    }
    const provider = entry == null ? void 0 : entry.providerData;
    if (!provider || typeof provider !== "object") return;
    const usage = provider.usage;
    if (!usage || typeof usage !== "object") return;
    const ts = toMillis(entry.timestamp);
    if (!Number.isFinite(ts) || ts <= 0) return;
    const sid = typeof entry.sessionId === "string" ? entry.sessionId : "";
    const project = typeof entry.cwd === "string" ? entry.cwd : "";
    const model = typeof provider.model === "string" && provider.model ? provider.model : typeof provider.requestModelId === "string" && provider.requestModelId ? provider.requestModelId : "unknown";
    const inputTotal = num(usage.inputTokens);
    const cacheRead = Math.min(sumDetail(usage.inputTokensDetails, "cached_tokens"), inputTotal);
    const input = inputTotal - cacheRead;
    const output = num(usage.outputTokens);
    const reasoning = sumDetail(usage.outputTokensDetails, "reasoning_tokens");
    recordFileBucket(state, fileBuckets, localHourKey(ts), CODEBUDDY, model, project, {
      r: 1,
      i: input,
      o: output,
      cr: cacheRead,
      cw: 0,
      rz: reasoning
    });
    recordFileSession(state, fileSessions, CODEBUDDY, sid, {
      t: ts,
      r: 1,
      p: project,
      model,
      i: input,
      o: output,
      cr: cacheRead,
      cw: 0,
      rz: reasoning,
      title: sessionTitle || void 0
    });
    recordCall(state, CODEBUDDY, {
      t: ts,
      m: model,
      p: project,
      s: sid,
      i: input,
      o: output,
      cr: cacheRead,
      cw: 0,
      rz: reasoning,
      cost: 0,
      credits: 0,
      f: path
    });
  });
  if (!result) return;
  const ledgerFrom0 = !previousState || previousState.offset === 0 || Boolean(previousState.ledgerFrom0);
  const fileState = { offset: result.offset, size: result.size, mtimeMs: result.mtimeMs };
  if (ledgerFrom0) fileState.ledgerFrom0 = true;
  if (sessionTitle) fileState.sessionTitle = sessionTitle;
  if (Object.keys(fileBuckets).length > 0) fileState.buckets = fileBuckets;
  if (Object.keys(fileSessions).length > 0) fileState.sessions = fileSessions;
  state.files[path] = fileState;
}

// server/scan/codex.ts
var import_node_os3 = require("os");
var import_node_path5 = require("path");
var CODEX = "codex";
function codexRoots(env = process.env) {
  var _a;
  const home = ((_a = env.CODEX_HOME) == null ? void 0 : _a.trim()) || (0, import_node_path5.join)((0, import_node_os3.homedir)(), ".codex");
  return [(0, import_node_path5.join)(home, "sessions"), (0, import_node_path5.join)(home, "archived_sessions")];
}
var BURST_WINDOW_MS = 2e3;
async function scanCodexFile(state, path) {
  const previousState = state.files[path];
  const fileBuckets = (previousState == null ? void 0 : previousState.buckets) ? { ...previousState.buckets } : {};
  const fileSessions = (previousState == null ? void 0 : previousState.sessions) ? { ...previousState.sessions } : {};
  let project = (previousState == null ? void 0 : previousState.project) ?? "";
  let model = (previousState == null ? void 0 : previousState.model) ?? "";
  let session = (previousState == null ? void 0 : previousState.session) ?? "";
  let title = (previousState == null ? void 0 : previousState.sessionTitle) ?? "";
  let totals = (previousState == null ? void 0 : previousState.totals) ?? null;
  let fork = (previousState == null ? void 0 : previousState.codexFork) ?? { forked: false, point: null, baselineDone: false, firstTs: null };
  const result = await forEachNewLine(path, (previousState == null ? void 0 : previousState.offset) ?? 0, (line) => {
    var _a, _b;
    if (!title && (line.includes('"response_item"') || line.includes('"user_message"'))) {
      try {
        const entry2 = JSON.parse(line);
        const payload = entry2 == null ? void 0 : entry2.payload;
        if ((payload == null ? void 0 : payload.type) === "user_message") {
          const text = clipTitle(payload.message);
          if (text) title = text;
        } else if ((payload == null ? void 0 : payload.type) === "message" && payload.role === "user") {
          const text = firstMessageText(payload.content);
          if (text && !MACHINE_LABEL.test(text)) {
            const label = clipTitle(text);
            if (label) title = label;
          }
        }
      } catch {
      }
    }
    if (line.includes('"session_meta"')) {
      try {
        const entry2 = JSON.parse(line);
        const payload = (entry2 == null ? void 0 : entry2.payload) ?? {};
        if (!project && typeof payload.cwd === "string") project = payload.cwd;
        const metaSession = payload.id ?? payload.session_id;
        if (!session && typeof metaSession === "string") session = metaSession;
        if (typeof payload.forked_from_id === "string" && payload.forked_from_id) {
          fork = {
            forked: true,
            point: typeof payload.forked_from_ordinal_exclusive === "number" ? payload.forked_from_ordinal_exclusive : null,
            baselineDone: false,
            firstTs: null
          };
        }
      } catch {
      }
      return;
    }
    if (line.includes('"turn_context"')) {
      try {
        const entry2 = JSON.parse(line);
        const value = (_a = entry2 == null ? void 0 : entry2.payload) == null ? void 0 : _a.model;
        if (typeof value === "string" && value) model = value;
      } catch {
      }
      return;
    }
    if (!line.includes('"token_count"')) return;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      return;
    }
    const info = (_b = entry == null ? void 0 : entry.payload) == null ? void 0 : _b.info;
    if (!info) return;
    const total = info.total_token_usage;
    if (!total || typeof total !== "object") return;
    const current = [
      num(total.input_tokens),
      num(total.cached_input_tokens),
      num(total.cache_write_input_tokens),
      num(total.output_tokens),
      num(total.reasoning_output_tokens),
      num(total.total_tokens)
    ];
    const ts = Date.parse(entry.timestamp);
    const ordinal = num(entry.ordinal);
    if (fork.forked && !fork.baselineDone) {
      if (fork.point !== null) {
        if (!(ordinal > 0 && ordinal > fork.point)) {
          totals = current;
          return;
        }
        const last = info.last_token_usage;
        if (last && typeof last === "object" && Number.isFinite(ts)) {
          const lCached = num(last.cached_input_tokens);
          const lInput = num(last.input_tokens);
          const lOutput = num(last.output_tokens);
          if (lInput + lCached + lOutput > 0) {
            const input2 = Math.max(0, lInput - lCached);
            const activeModel2 = model || "codex";
            recordFileBucket(state, fileBuckets, localHourKey(ts), CODEX, activeModel2, project, {
              r: 1,
              i: input2,
              o: lOutput,
              cr: lCached,
              cw: num(last.cache_write_input_tokens),
              rz: num(last.reasoning_output_tokens)
            });
            recordFileSession(state, fileSessions, CODEX, session, {
              t: ts,
              r: 1,
              p: project,
              model: activeModel2,
              title: title || void 0,
              i: input2,
              o: lOutput,
              cr: lCached,
              cw: num(last.cache_write_input_tokens),
              rz: num(last.reasoning_output_tokens)
            });
            recordCall(state, CODEX, {
              t: ts,
              m: activeModel2,
              p: project,
              s: session,
              i: input2,
              o: lOutput,
              cr: lCached,
              cw: num(last.cache_write_input_tokens),
              rz: num(last.reasoning_output_tokens),
              cost: 0,
              credits: 0,
              f: path
            });
          }
        }
        fork.baselineDone = true;
        totals = current;
        return;
      }
      if (fork.firstTs === null && Number.isFinite(ts)) fork.firstTs = ts;
      if (!Number.isFinite(ts) || fork.firstTs === null || ts - fork.firstTs <= BURST_WINDOW_MS) {
        totals = current;
        return;
      }
      fork.baselineDone = true;
    }
    if (fork.forked && fork.baselineDone && fork.point !== null && ordinal > 0 && ordinal <= fork.point) {
      totals = current;
      return;
    }
    const before = totals;
    totals = current;
    const delta = before ? current.map((value, index) => Math.max(0, value - (before[index] ?? 0))) : current.slice();
    const dInput = delta[0] ?? 0;
    const dCached = delta[1] ?? 0;
    const dCacheWrite = delta[2] ?? 0;
    const dOutput = delta[3] ?? 0;
    const dReasoning = delta[4] ?? 0;
    const dTotal = delta[5] ?? 0;
    if (dTotal <= 0) return;
    if (!Number.isFinite(ts)) return;
    const input = Math.max(0, dInput - dCached);
    const activeModel = model || "codex";
    recordFileBucket(state, fileBuckets, localHourKey(ts), CODEX, activeModel, project, {
      r: 1,
      i: input,
      o: dOutput,
      cr: dCached,
      cw: dCacheWrite,
      rz: dReasoning
    });
    recordFileSession(state, fileSessions, CODEX, session, {
      t: ts,
      r: 1,
      p: project,
      model: activeModel,
      title: title || void 0,
      i: input,
      o: dOutput,
      cr: dCached,
      cw: dCacheWrite,
      rz: dReasoning
    });
    recordCall(state, CODEX, {
      t: ts,
      m: activeModel,
      p: project,
      s: session,
      i: input,
      o: dOutput,
      cr: dCached,
      cw: dCacheWrite,
      rz: dReasoning,
      cost: 0,
      credits: 0,
      f: path
    });
  });
  if (!result) return;
  const ledgerFrom0 = !previousState || previousState.offset === 0 || Boolean(previousState.ledgerFrom0);
  const fileState = { offset: result.offset, size: result.size, mtimeMs: result.mtimeMs, project, model, session };
  if (ledgerFrom0) fileState.ledgerFrom0 = true;
  if (title) fileState.sessionTitle = title;
  if (totals) fileState.totals = totals;
  if (fork.forked) fileState.codexFork = fork;
  if (Object.keys(fileBuckets).length > 0) fileState.buckets = fileBuckets;
  if (Object.keys(fileSessions).length > 0) fileState.sessions = fileSessions;
  state.files[path] = fileState;
}

// server/scan/opencode.ts
var import_node_fs = require("fs");
var import_node_module = require("module");
var import_node_os4 = require("os");
var import_node_path6 = require("path");
var OPENCODE = "opencode";
var SEEN_LIMIT = 1e4;
var INCOMPLETE_GRACE_MS = 60 * 60 * 1e3;
var BATCH_SIZE = 4e3;
var MAX_BATCHES = 500;
var sqliteModule;
async function loadSqlite() {
  if (sqliteModule !== void 0) return sqliteModule;
  try {
    const requireFn = (0, import_node_module.createRequire)((0, import_node_path6.join)(process.cwd(), "agent-usage-sqlite.cjs"));
    sqliteModule = requireFn("node:sqlite");
  } catch {
    sqliteModule = null;
  }
  return sqliteModule;
}
function opencodeDbPath(env = process.env) {
  var _a;
  const dataHome = ((_a = env.XDG_DATA_HOME) == null ? void 0 : _a.trim()) || (0, import_node_path6.join)((0, import_node_os4.homedir)(), ".local", "share");
  return (0, import_node_path6.join)(dataHome, "opencode", "opencode.db");
}
function hasTable(db, name) {
  try {
    return db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").all(name).length > 0;
  } catch {
    return false;
  }
}
function parseData(value) {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
function modelId(data, fallback) {
  const direct = data.modelID;
  if (typeof direct === "string" && direct) return direct;
  const model = data.model;
  if (typeof model === "string" && model) return model;
  if (model && typeof model === "object") {
    if (typeof model.id === "string" && model.id) return model.id;
    if (typeof model.modelID === "string" && model.modelID) return model.modelID;
    if (typeof model.providerID === "string" && model.providerID) return model.providerID;
  }
  if (typeof fallback === "string" && fallback) {
    try {
      const parsed = JSON.parse(fallback);
      if (parsed && typeof parsed === "object" && typeof parsed.id === "string" && parsed.id) return parsed.id;
    } catch {
    }
  }
  return "unknown";
}
function projectPath(data, ...fallbacks) {
  const path = data.path;
  if (path && typeof path === "object") {
    if (typeof path.cwd === "string" && path.cwd) return path.cwd;
    if (typeof path.root === "string" && path.root) return path.root;
  }
  for (const value of fallbacks) if (typeof value === "string" && value) return value;
  return "";
}
function parseCall(row, data, v2, now) {
  var _a, _b;
  if (!v2 && data.role !== "assistant") return null;
  const tokens = data.tokens;
  if (!tokens || typeof tokens !== "object") return null;
  const cache = tokens.cache && typeof tokens.cache === "object" ? tokens.cache : {};
  const input = num(tokens.input);
  const output = num(tokens.output);
  const reasoning = num(tokens.reasoning);
  const cacheRead = num(cache.read);
  const cacheWrite = num(cache.write);
  const cost = Math.max(0, num(data.cost));
  const hasUsage = input + output + reasoning + cacheRead + cacheWrite > 0 || cost > 0;
  const isCompaction = v2 && row.message_type === "compaction";
  const completedAt = num((_a = data.time) == null ? void 0 : _a.completed);
  const status = typeof data.status === "string" ? data.status : "";
  const terminalStatus = status === "completed" || status === "failed";
  const stale = num(row.time_updated) > 0 && now - num(row.time_updated) > INCOMPLETE_GRACE_MS;
  const complete = (isCompaction ? terminalStatus : completedAt > 0) || stale && hasUsage;
  return {
    id: typeof row.id === "string" ? row.id : "",
    ts: num((_b = data.time) == null ? void 0 : _b.created) || num(row.time_created),
    session: typeof row.session_id === "string" ? row.session_id : "",
    model: modelId(data),
    project: projectPath(data),
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    cost,
    complete
  };
}
function countCall(state, call, seen, seenOrder) {
  if (!call.complete) return;
  if (call.id && seen.has(call.id)) return;
  const total = call.input + call.output + call.reasoning + call.cacheRead + call.cacheWrite;
  if (total <= 0 && call.cost <= 0) return;
  const outputWithReasoning = call.output + call.reasoning;
  addBucket(state.buckets, localHourKey(call.ts), OPENCODE, call.model, call.project, {
    r: 1,
    i: call.input,
    o: outputWithReasoning,
    cr: call.cacheRead,
    cw: call.cacheWrite,
    rz: call.reasoning,
    cost: call.cost
  });
  applySession(state.sessions, OPENCODE, call.session, {
    t: call.ts,
    r: 1,
    p: call.project,
    model: call.model,
    i: call.input,
    o: outputWithReasoning,
    cr: call.cacheRead,
    cw: call.cacheWrite,
    rz: call.reasoning,
    cost: call.cost,
    title: call.title
  });
  recordCall(state, OPENCODE, {
    t: call.ts,
    m: call.model,
    p: call.project,
    s: call.session,
    i: call.input,
    o: outputWithReasoning,
    cr: call.cacheRead,
    cw: call.cacheWrite,
    rz: call.reasoning,
    cost: call.cost,
    credits: 0
  });
  if (call.id) {
    seen.add(call.id);
    seenOrder.push(call.id);
  }
}
async function scanOpencode(state, path = opencodeDbPath()) {
  if (!(0, import_node_fs.existsSync)(path)) return;
  const sqlite = await loadSqlite();
  if (!sqlite) {
    console.warn("[agent-usage] opencode skipped: node:sqlite unavailable (needs Node >= 22.5)");
    return;
  }
  let db = null;
  try {
    try {
      db = new sqlite.DatabaseSync(path, { readOnly: true });
    } catch (error) {
      console.warn("[agent-usage] opencode skipped: cannot open the database read-only", error);
      return;
    }
    const hasV2Messages = hasTable(db, "session_message");
    const hasV2Sessions = hasTable(db, "session_v2");
    const hasV1Messages = hasTable(db, "message");
    const hasV1Sessions = hasTable(db, "session");
    if (!hasV2Messages && !hasV1Messages) return;
    const seen = new Set(state.opencode.seen ?? []);
    const seenOrder = [...state.opencode.seen ?? []];
    const now = Date.now();
    let watermark = state.opencode.watermark;
    let lastId = state.opencode.lastId ?? "";
    let legacyWatermark = state.opencode.legacyWatermark ?? watermark;
    let legacyLastId = state.opencode.legacyLastId ?? lastId;
    let holdWatermark = null;
    let holdLegacy = null;
    if (hasV1Messages) {
      const titles = /* @__PURE__ */ new Map();
      if (hasV1Sessions) {
        try {
          const titleStatement = db.prepare("SELECT id, title FROM session WHERE title IS NOT NULL AND title <> ''");
          for (const row of titleStatement.all()) {
            if (typeof row.id === "string" && typeof row.title === "string") titles.set(row.id, clipTitle(row.title));
          }
        } catch {
        }
      }
      let cursorTime = hasV2Messages ? legacyWatermark : watermark;
      let cursorId = hasV2Messages ? legacyLastId : lastId;
      const statement = db.prepare(
        `SELECT id, session_id, time_created, time_updated, data FROM message
         WHERE time_updated > ? OR (time_updated = ? AND id > ?)
         ORDER BY time_updated ASC, id ASC LIMIT ${BATCH_SIZE}`
      );
      let maxTime = cursorTime;
      let maxId = cursorId;
      for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
        const rows = statement.all(cursorTime, cursorTime, cursorId);
        if (rows.length === 0) break;
        for (const row of rows) {
          const id = typeof row.id === "string" ? row.id : "";
          const updated = num(row.time_updated);
          if (updated > maxTime || updated === maxTime && id > maxId) {
            maxTime = updated;
            maxId = id;
          }
          const data = parseData(row.data);
          if (!data) continue;
          const call = parseCall(row, data, false, now);
          if (!call) continue;
          if (!call.complete) {
            if (updated > 0 && (call.input + call.output + call.reasoning + call.cacheRead + call.cacheWrite > 0 || call.cost > 0)) {
              if (holdLegacy === null || updated < holdLegacy) holdLegacy = updated;
            }
            continue;
          }
          call.title = titles.get(call.session);
          countCall(state, call, seen, seenOrder);
        }
        cursorTime = maxTime;
        cursorId = maxId;
        if (rows.length < BATCH_SIZE) break;
      }
      if (hasV2Messages) {
        legacyWatermark = maxTime;
        legacyLastId = maxId;
      } else {
        watermark = maxTime;
        lastId = maxId;
        legacyWatermark = watermark;
        legacyLastId = lastId;
      }
    }
    if (hasV2Messages) {
      let cursorTime = watermark;
      let cursorId = lastId;
      const modelCache = /* @__PURE__ */ new Map();
      const statement = db.prepare(
        hasV2Sessions ? `SELECT m.id, m.session_id, m.time_created, m.time_updated, m.data, m.type AS message_type,
                    s.title AS session_title, s.directory AS session_directory,
                    s.model AS session_model, p.worktree AS project_worktree
             FROM session_message m
             LEFT JOIN session_v2 s ON s.id = m.session_id
             LEFT JOIN project p ON p.id = s.project_id
             WHERE (m.time_updated > ? OR (m.time_updated = ? AND m.id > ?))
               AND m.type IN ('assistant', 'compaction')
             ORDER BY m.time_updated ASC, m.id ASC LIMIT ${BATCH_SIZE}` : `SELECT m.id, m.session_id, m.time_created, m.time_updated, m.data, m.type AS message_type
             FROM session_message m
             WHERE (m.time_updated > ? OR (m.time_updated = ? AND m.id > ?))
               AND m.type IN ('assistant', 'compaction')
             ORDER BY m.time_updated ASC, m.id ASC LIMIT ${BATCH_SIZE}`
      );
      let maxTime = cursorTime;
      let maxId = cursorId;
      for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
        const rows = statement.all(cursorTime, cursorTime, cursorId);
        if (rows.length === 0) break;
        for (const row of rows) {
          const id = typeof row.id === "string" ? row.id : "";
          const updated = num(row.time_updated);
          if (updated > maxTime || updated === maxTime && id > maxId) {
            maxTime = updated;
            maxId = id;
          }
          const data = parseData(row.data);
          if (!data) continue;
          const call = parseCall(row, data, true, now);
          if (!call) continue;
          if (!call.complete) {
            if (updated > 0 && (call.input + call.output + call.reasoning + call.cacheRead + call.cacheWrite > 0 || call.cost > 0)) {
              if (holdWatermark === null || updated < holdWatermark) holdWatermark = updated;
            }
            continue;
          }
          if (row.session_title) call.title = clipTitle(row.session_title);
          call.project = projectPath(data, row.session_directory, row.project_worktree);
          if (call.model === "unknown") {
            if (!modelCache.has(call.session)) modelCache.set(call.session, modelId({}, row.session_model));
            call.model = modelCache.get(call.session) || "unknown";
          }
          countCall(state, call, seen, seenOrder);
        }
        cursorTime = maxTime;
        cursorId = maxId;
        if (rows.length < BATCH_SIZE) break;
      }
      watermark = maxTime;
      lastId = maxId;
    }
    if (holdWatermark !== null) {
      watermark = Math.max(0, holdWatermark - 1);
      lastId = "";
    }
    if (holdLegacy !== null) {
      if (hasV2Messages) {
        legacyWatermark = Math.max(0, holdLegacy - 1);
        legacyLastId = "";
      } else {
        watermark = Math.max(0, holdLegacy - 1);
        lastId = "";
      }
    }
    if (!hasV1Messages) {
      legacyWatermark = watermark;
      legacyLastId = lastId;
    }
    state.opencode.watermark = watermark;
    state.opencode.lastId = lastId;
    state.opencode.legacyWatermark = legacyWatermark;
    state.opencode.legacyLastId = legacyLastId;
    state.opencode.seen = seenOrder.length > SEEN_LIMIT ? seenOrder.slice(-SEEN_LIMIT) : seenOrder;
  } finally {
    db == null ? void 0 : db.close();
  }
}

// server/scan/pi.ts
var import_node_os5 = require("os");
var import_node_path7 = require("path");
var PI = "pi";
var PI_SEEN_LIMIT = 4e5;
var seenCache = /* @__PURE__ */ new WeakMap();
function piRoots(env = process.env) {
  var _a, _b;
  const home = (0, import_node_os5.homedir)();
  const roots = [];
  const sessionDir = (_a = env.PI_CODING_AGENT_SESSION_DIR) == null ? void 0 : _a.trim();
  if (sessionDir) roots.push(sessionDir);
  const agentDir = ((_b = env.PI_CODING_AGENT_DIR) == null ? void 0 : _b.trim()) || (0, import_node_path7.join)(home, ".pi", "agent");
  roots.push((0, import_node_path7.join)(agentDir, "sessions"));
  return [...new Set(roots)];
}
async function scanPiFile(state, path) {
  const previousState = state.files[path];
  const fileBuckets = (previousState == null ? void 0 : previousState.buckets) ? { ...previousState.buckets } : {};
  const fileSessions = (previousState == null ? void 0 : previousState.sessions) ? { ...previousState.sessions } : {};
  let project = (previousState == null ? void 0 : previousState.project) ?? "";
  let title = (previousState == null ? void 0 : previousState.sessionTitle) ?? "";
  const base = path.split("/").pop() ?? "";
  const underscore = base.lastIndexOf("_");
  const session = (underscore >= 0 ? base.slice(underscore + 1) : base).replace(/\.jsonl$/, "");
  const cached = seenCache.get(state);
  const ledger = !cached || cached.keys !== state.pi.seen ? { keys: state.pi.seen, set: new Set(state.pi.seen) } : cached;
  seenCache.set(state, ledger);
  const seen = ledger.set;
  const result = await forEachNewLine(path, (previousState == null ? void 0 : previousState.offset) ?? 0, (line) => {
    var _a, _b;
    if (line.includes('"role":"user"')) {
      try {
        const entry2 = JSON.parse(line);
        const raw = (entry2 == null ? void 0 : entry2.type) === "message" && ((_a = entry2.message) == null ? void 0 : _a.role) === "user" ? firstMessageText(entry2.message.content) : "";
        const text = raw && !MACHINE_LABEL.test(raw.trim()) ? clipTitle(raw) : "";
        if (text && !title) title = text;
      } catch {
      }
    }
    if (!project && line.includes('"type":"session"')) {
      try {
        const entry2 = JSON.parse(line);
        if (typeof (entry2 == null ? void 0 : entry2.cwd) === "string") project = entry2.cwd;
      } catch {
      }
      return;
    }
    if (!line.includes('"usage"') || !line.includes('"assistant"')) return;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      return;
    }
    if ((entry == null ? void 0 : entry.type) !== "message") return;
    const message = entry.message;
    if (!message || typeof message !== "object" || message.role !== "assistant") return;
    const usage = message.usage;
    if (!usage || typeof usage !== "object") return;
    const ts = Date.parse(entry.timestamp);
    if (!Number.isFinite(ts)) return;
    const entryId = typeof entry.id === "string" ? entry.id : "";
    const timestamp = typeof entry.timestamp === "string" ? entry.timestamp : "";
    if (entryId && timestamp) {
      const key = `${entryId}@${timestamp}`;
      if (seen.has(key)) return;
      seen.add(key);
      state.pi.seen.push(key);
    }
    const cost = typeof ((_b = usage.cost) == null ? void 0 : _b.total) === "number" && usage.cost.total > 0 ? usage.cost.total : 0;
    const model = typeof message.model === "string" && message.model ? message.model : "unknown";
    const input = num(usage.input);
    const output = num(usage.output);
    const cacheRead = num(usage.cacheRead);
    const cacheWrite = num(usage.cacheWrite);
    const reasoning = num(usage.reasoning);
    recordFileBucket(state, fileBuckets, localHourKey(ts), PI, model, project, {
      r: 1,
      i: input,
      o: output,
      cr: cacheRead,
      cw: cacheWrite,
      rz: reasoning,
      cost
    });
    recordFileSession(state, fileSessions, PI, session, {
      t: ts,
      r: 1,
      p: project,
      model,
      title: title || void 0,
      i: input,
      o: output,
      cr: cacheRead,
      cw: cacheWrite,
      rz: reasoning,
      cost
    });
    recordCall(state, PI, {
      t: ts,
      m: model,
      p: project,
      s: session,
      i: input,
      o: output,
      cr: cacheRead,
      cw: cacheWrite,
      rz: reasoning,
      cost,
      credits: 0,
      f: path
    });
  });
  if (!result) return;
  if (state.pi.seen.length > PI_SEEN_LIMIT) {
    const removed = state.pi.seen.splice(0, state.pi.seen.length - PI_SEEN_LIMIT);
    for (const key of removed) seen.delete(key);
  }
  const ledgerFrom0 = !previousState || previousState.offset === 0 || Boolean(previousState.ledgerFrom0);
  const fileState = { offset: result.offset, size: result.size, mtimeMs: result.mtimeMs, project, sessionTitle: title || void 0 };
  if (ledgerFrom0) fileState.ledgerFrom0 = true;
  if (Object.keys(fileBuckets).length > 0) fileState.buckets = fileBuckets;
  if (Object.keys(fileSessions).length > 0) fileState.sessions = fileSessions;
  state.files[path] = fileState;
}

// server/scan/agy.ts
var import_promises3 = require("fs/promises");
var import_node_os6 = require("os");
var import_node_path8 = require("path");
var import_node_timers = require("timers");
var import_node_url = require("url");
var AGY = "agy";
var DATABASE_NAME = /^([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})\.db$/i;
var PLANNER_RESPONSE = 15;
function readVarint(bytes, offset) {
  let value = 0;
  for (let shift = 0; shift < 70 && offset < bytes.length; shift += 7) {
    const byte = bytes[offset++];
    value += (byte & 127) * 2 ** shift;
    if (byte < 128) return [value, offset];
  }
  return null;
}
function readFields(value, wanted) {
  const fields = /* @__PURE__ */ new Map();
  if (!(value instanceof Uint8Array)) return fields;
  let offset = 0;
  while (offset < value.length) {
    const tag = readVarint(value, offset);
    if (!tag || tag[0] < 8 || tag[0] > 4294967295) return /* @__PURE__ */ new Map();
    const [key, start] = tag;
    const field = key >>> 3;
    const type = key & 7;
    if (type === 0 || type === 2) {
      const item = readVarint(value, start);
      if (!item) return /* @__PURE__ */ new Map();
      const [number, next] = item;
      offset = type === 0 ? next : next + number;
      if (offset > value.length) return /* @__PURE__ */ new Map();
      if (wanted.includes(field)) {
        fields.set(field, type === 0 ? number : value.subarray(next, offset));
      }
    } else if (type === 1 || type === 5) {
      offset = start + (type === 1 ? 8 : 4);
      if (offset > value.length) return /* @__PURE__ */ new Map();
    } else {
      return /* @__PURE__ */ new Map();
    }
  }
  return fields;
}
function count(fields, field) {
  const value = fields.get(field);
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
function readCreatedAt(metadata) {
  const timestamp = readFields(readFields(metadata, [1]).get(1), [1, 2]);
  const seconds = count(timestamp, 1);
  const nanos = count(timestamp, 2);
  return seconds > 0 && seconds <= 253402300799 && nanos < 1e9 ? { seconds, nanos } : null;
}
function readGeneration(blob) {
  var _a;
  const generation = readFields(blob, [1, 2]);
  const steps = generation.get(2);
  const firstStep = steps instanceof Uint8Array ? (_a = readVarint(steps, 0)) == null ? void 0 : _a[0] : steps;
  if (firstStep === void 0 || !Number.isSafeInteger(firstStep)) return null;
  const result = readFields(generation.get(1), [4, 19]);
  const usage = readFields(result.get(4), [2, 3, 4, 5, 9]);
  const tokens = {
    i: count(usage, 2),
    o: count(usage, 3),
    cw: count(usage, 4),
    cr: count(usage, 5),
    rz: count(usage, 9)
  };
  if (tokens.i + tokens.o + tokens.cw + tokens.cr === 0) return null;
  const name = result.get(19);
  const decoded = name instanceof Uint8Array && name.length <= 128 ? Buffer.from(name).toString("utf8") : "";
  const model = /^[a-z0-9][a-z0-9_.:/-]*$/i.test(decoded) ? decoded : "unknown";
  return { firstStep, model, tokens };
}
function readProjects(sqlite, root) {
  const projects = /* @__PURE__ */ new Map();
  let db;
  try {
    db = new sqlite.DatabaseSync((0, import_node_path8.join)(root, "conversation_summaries.db"), { readOnly: true });
    const rows = db.prepare("SELECT conversation_id, workspace_uris FROM conversation_summaries").all();
    for (const row of rows) {
      let uris;
      try {
        uris = JSON.parse(row.workspace_uris);
      } catch {
        continue;
      }
      if (!Array.isArray(uris)) continue;
      for (const uri of uris) {
        if (typeof uri !== "string" || !uri.startsWith("file:")) continue;
        try {
          const project = (0, import_node_url.fileURLToPath)(uri);
          if (project === "/" || /^[a-z]:[\\/]$/i.test(project) || project.includes("")) continue;
          projects.set(row.conversation_id, project);
          break;
        } catch {
        }
      }
    }
  } catch {
  } finally {
    db == null ? void 0 : db.close();
  }
  return projects;
}
function readConversation(sqlite, file, sid, project, replayed) {
  const db = new sqlite.DatabaseSync(file, { readOnly: true });
  try {
    db.exec("BEGIN");
    const steps = db.prepare("SELECT idx, metadata FROM steps WHERE step_type = ?").all(PLANNER_RESPONSE);
    const times = /* @__PURE__ */ new Map();
    for (const row of steps) times.set(row.idx, readCreatedAt(row.metadata));
    const calls = [];
    const keys = [];
    const generations = db.prepare("SELECT data FROM gen_metadata ORDER BY idx").all();
    for (const row of generations) {
      const generation = readGeneration(row.data);
      if (!generation) continue;
      const created = times.get(generation.firstStep);
      if (!created) continue;
      const { model, tokens } = generation;
      const key = JSON.stringify([created.seconds, created.nanos, model, tokens.i, tokens.o, tokens.cr, tokens.cw, tokens.rz]);
      if (replayed.has(key)) continue;
      replayed.add(key);
      keys.push(key);
      const t = created.seconds * 1e3 + Math.floor(created.nanos / 1e6);
      calls.push({ t, m: model, p: project, s: sid, ...tokens, cost: 0, credits: 0 });
    }
    return { calls, keys };
  } finally {
    db.close();
  }
}
function isUnsupportedDatabase(error) {
  if (!(error instanceof Error) || !("errcode" in error)) return false;
  const code = typeof error.errcode === "number" ? error.errcode & 255 : 0;
  return code === 11 || code === 26 || code === 1 && /no such (?:table|column):/i.test(error.message);
}
async function scanAgy(state, shouldStop, root = (0, import_node_path8.join)((0, import_node_os6.homedir)(), ".gemini", "antigravity-cli"), options) {
  var _a, _b, _c;
  const directory = (0, import_node_path8.join)(root, "conversations");
  const entries = await (0, import_promises3.readdir)(directory, { withFileTypes: true }).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (!entries) {
    (_a = state.recent)[AGY] ?? (_a[AGY] = []);
    return;
  }
  const sqlite = await loadSqlite();
  if (!sqlite) {
    console.warn("[agent-usage] agy skipped: node:sqlite unavailable (needs Node >= 22.5)");
    (_b = state.recent)[AGY] ?? (_b[AGY] = []);
    return;
  }
  const projects = readProjects(sqlite, root);
  const freshBySid = /* @__PURE__ */ new Map();
  const presentOnDisk = /* @__PURE__ */ new Set();
  const unreadableOnDisk = /* @__PURE__ */ new Set();
  const replayed = /* @__PURE__ */ new Set();
  const dbEntries = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const sid = (_c = DATABASE_NAME.exec(entry.name)) == null ? void 0 : _c[1];
    if (!sid || !entry.isFile()) continue;
    dbEntries.push({ sid, name: entry.name });
  }
  const diskSids = new Set(dbEntries.map((item) => item.sid));
  for (const [sid, archived] of Object.entries(state.agy ?? {})) {
    if (diskSids.has(sid) || !archived.keys) continue;
    for (const key of archived.keys) replayed.add(key);
  }
  let recent = [];
  let read = 0;
  let skipped = 0;
  for (const { sid, name } of dbEntries) {
    await new Promise((resolve2) => (0, import_node_timers.setImmediate)(resolve2));
    if (shouldStop()) return;
    const project = projects.get(sid) ?? "";
    const file = (0, import_node_path8.join)(directory, name);
    let parsed;
    try {
      parsed = readConversation(sqlite, file, sid, project, replayed);
    } catch (error) {
      const present = await (0, import_promises3.stat)(file).then(() => true, (failure) => failure.code !== "ENOENT");
      if (!present) continue;
      if (!isUnsupportedDatabase(error)) throw error;
      presentOnDisk.add(sid);
      unreadableOnDisk.add(sid);
      skipped += 1;
      continue;
    }
    read += 1;
    presentOnDisk.add(sid);
    const { calls, keys } = parsed;
    if (calls.length) {
      const convBuckets = {};
      const convSessions = {};
      for (const call of calls) {
        const delta = { ...call, r: 1, model: call.m };
        addBucket(convBuckets, localHourKey(call.t), AGY, call.m, project, delta);
        applySession(convSessions, AGY, sid, delta);
      }
      const session = convSessions[`${AGY}${sid}`];
      const conv = session ? { buckets: convBuckets, session } : { buckets: convBuckets };
      if (keys.length > 0) conv.keys = keys;
      freshBySid.set(sid, conv);
      recent = recent.concat(calls).sort((a, b) => a.t - b.t).slice(-MAX_RECENT_PER_AGENT);
    }
  }
  if (skipped) {
    console.warn(`[agent-usage] agy skipped ${skipped} corrupt or incompatible conversation database(s)`);
    if (!read) return;
  }
  const nextAgy = {};
  for (const [sid, archived] of Object.entries(state.agy ?? {})) {
    if (!presentOnDisk.has(sid)) {
      nextAgy[sid] = { ...archived, archived: true };
    } else if (unreadableOnDisk.has(sid)) {
      const kept = archived.session ? { buckets: archived.buckets, session: archived.session } : { buckets: archived.buckets };
      if (archived.keys && archived.keys.length > 0) kept.keys = archived.keys;
      nextAgy[sid] = kept;
    }
  }
  for (const [sid, fresh] of freshBySid) {
    nextAgy[sid] = fresh;
  }
  for (const key of Object.keys(state.buckets)) {
    if (key.split("", 2)[1] === AGY) delete state.buckets[key];
  }
  for (const key of Object.keys(state.sessions)) {
    if (key.startsWith(AGY + "")) delete state.sessions[key];
  }
  for (const [sid, conv] of Object.entries(nextAgy)) {
    mergeBuckets(state.buckets, conv.buckets, 1);
    if (conv.session) mergeSessionEntry(state.sessions, `${AGY}${sid}`, conv.session, 1);
  }
  if (Object.keys(nextAgy).length > 0) state.agy = nextAgy;
  else delete state.agy;
  const retentionDays = (options == null ? void 0 : options.archiveRetentionDays) ?? DEFAULT_ARCHIVE_RETENTION_DAYS;
  pruneArchivedHistory(state, retentionDays, (options == null ? void 0 : options.now) ?? Date.now());
  if (recent.length > 0 || state.recent[AGY] === void 0) {
    state.recent[AGY] = recent;
  }
}

// server/scan/scanner.ts
async function scanAll(state, callbacks, enabledHarnesses, options) {
  const on = (id) => !enabledHarnesses || enabledHarnesses.has(id);
  const retentionDays = (options == null ? void 0 : options.archiveRetentionDays) ?? DEFAULT_ARCHIVE_RETENTION_DAYS;
  const now = (options == null ? void 0 : options.now) ?? Date.now();
  const [claudeFiles, piFiles, codexFiles, codebuddyFiles] = await Promise.all([
    collectRoots(claudeRoots()),
    collectRoots(piRoots()),
    collectRoots(codexRoots()),
    collectRoots(codebuddyRoots())
  ]);
  await reconcileTrackedFiles(state, new Set(piFiles), [
    ...on("claude") ? claudeFiles : [],
    ...on("codex") ? codexFiles : [],
    ...on("codebuddy") ? codebuddyFiles : []
  ]);
  const total = (on("claude") ? claudeFiles.length : 0) + (on("pi") ? piFiles.length : 0) + (on("codex") ? codexFiles.length : 0) + (on("codebuddy") ? codebuddyFiles.length : 0) + (on("opencode") ? 1 : 0) + (on(AGY) ? 1 : 0);
  let done = 0;
  let checkpointAt = Date.now();
  callbacks.onProgress(done, total);
  const tick = () => {
    done += 1;
    callbacks.onProgress(done, total);
    const nowTick = Date.now();
    if (nowTick - checkpointAt > 5e3) {
      checkpointAt = nowTick;
      callbacks.onCheckpoint();
    }
  };
  const run = async (files, scanOne) => {
    for (const file of files) {
      if (callbacks.shouldStop()) return false;
      try {
        await scanOne(state, file);
      } catch (error) {
        console.error("[agent-usage] scan failed for", file, error);
      }
      tick();
    }
    return true;
  };
  if (on("claude") && !await run(claudeFiles, scanClaudeFile)) return;
  if (on("pi") && !await run(piFiles, scanPiFile)) return;
  if (on("codebuddy") && !await run(codebuddyFiles, scanCodebuddyFile)) return;
  if (on("opencode")) {
    if (callbacks.shouldStop()) return;
    try {
      await scanOpencode(state);
    } catch (error) {
      console.error("[agent-usage] opencode scan failed", error);
    }
    tick();
  }
  if (on("codex") && !await run(codexFiles, scanCodexFile)) return;
  if (on(AGY)) {
    if (callbacks.shouldStop()) return;
    try {
      await scanAgy(state, callbacks.shouldStop, void 0, { archiveRetentionDays: retentionDays, now });
    } catch {
      console.warn("[agent-usage] agy scan could not read the local conversation databases");
    }
    tick();
  }
  pruneArchivedHistory(state, retentionDays, now);
  callbacks.onCheckpoint();
}
async function collectRoots(roots) {
  const seen = /* @__PURE__ */ new Set();
  for (const root of roots) {
    for (const file of await listJsonlFiles(root)) seen.add(file);
  }
  return [...seen].sort();
}
async function reconcileTrackedFiles(state, piFiles, reappearingCandidates = []) {
  var _a;
  let needsLegacyReset = false;
  for (const [path, file] of Object.entries(state.files)) {
    if (!file) {
      delete state.files[path];
      continue;
    }
    try {
      const info = await (0, import_promises4.stat)(path);
      if (file.offset > 0 && info.isFile() && info.size < file.offset) {
        const hasCompleteLedger = Boolean(file.ledgerFrom0);
        if (hasCompleteLedger && !piFiles.has(path)) {
          console.warn("[agent-usage] log file shrank; rescanning file surgically without dropping archive");
          revokeFileContribution(state, file, path);
          delete state.files[path];
        } else {
          needsLegacyReset = true;
        }
      }
    } catch (error) {
      const code = error == null ? void 0 : error.code;
      if (code === "ENOENT") {
        archiveFileContribution(state, file, path);
        delete state.files[path];
      }
    }
  }
  if ((_a = state.archive) == null ? void 0 : _a.files) {
    for (const path of reappearingCandidates) {
      if (state.files[path] || !state.archive.files[path]) continue;
      if (revokeArchivedFile(state, path) === "legacy_reset") {
        needsLegacyReset = true;
      }
    }
  }
  if (needsLegacyReset) {
    console.warn("[agent-usage] legacy log file shrank; resetting active counters while preserving archive");
    resetCountersPreservingArchive(state);
  }
}
function resetCountersPreservingArchive(state) {
  state.buckets = {};
  state.sessions = {};
  state.files = {};
  state.recent = {};
  state.opencode = { watermark: 0, lastId: "" };
  state.pi = { seen: [] };
  if (state.archive) {
    mergeBuckets(state.buckets, state.archive.buckets, 1);
    for (const [key, entry] of Object.entries(state.archive.sessions)) {
      mergeSessionEntry(state.sessions, key, entry, 1);
    }
  }
  if (state.agy) {
    for (const [sid, conv] of Object.entries(state.agy)) {
      mergeBuckets(state.buckets, conv.buckets, 1);
      if (conv.session) mergeSessionEntry(state.sessions, `${AGY}${sid}`, conv.session, 1);
    }
  }
}

// server/remote/collector.ts
function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] ?? null : null;
}
function parseRetentionDays(args) {
  const raw = argValue(args, "--archive-retention-days");
  if (raw === null) return DEFAULT_ARCHIVE_RETENTION_DAYS;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.min(3650, Math.round(value)) : DEFAULT_ARCHIVE_RETENTION_DAYS;
}
function exportRecent(recent) {
  const out = {};
  for (const [harness, list] of Object.entries(recent)) {
    out[harness] = list.map(({ f: _file, ...rest }) => rest);
  }
  return out;
}
async function main() {
  const args = process.argv.slice(2);
  const cacheDir = argValue(args, "--cache-dir") || (0, import_node_path9.join)((0, import_node_os7.homedir)(), ".cache", "agent-usage-plugin");
  const archiveRetentionDays = parseRetentionDays(args);
  const fresh = args.includes("--fresh");
  process.stderr.write(`agent-usage collector: node ${process.version}, cache ${cacheDir}${fresh ? ", fresh" : ""}
`);
  const state = fresh ? emptyState() : await loadState(cacheDir);
  let lastLog = 0;
  await scanAll(
    state,
    {
      shouldStop: () => false,
      onProgress: (done, total) => {
        const now = Date.now();
        if (now - lastLog > 3e3 || done === total) {
          lastLog = now;
          process.stderr.write(`progress ${done}/${total}
`);
        }
      },
      onCheckpoint: () => {
        void saveState(cacheDir, state).catch(() => {
        });
      }
    },
    void 0,
    { archiveRetentionDays }
  );
  state.meta.lastScanAt = Date.now();
  state.meta.scanError = null;
  await saveState(cacheDir, state);
  const projection = {
    v: 2,
    generatedAt: Date.now(),
    node: process.version,
    buckets: state.buckets,
    sessions: state.sessions,
    recent: exportRecent(state.recent)
  };
  process.stdout.write(JSON.stringify(projection));
  process.stderr.write(`agent-usage collector: done, ${Object.keys(state.buckets).length} buckets
`);
}
main().catch((error) => {
  process.stderr.write(`agent-usage collector failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}
`);
  process.exitCode = 1;
});
