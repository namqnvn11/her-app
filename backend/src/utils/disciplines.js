const Discipline = require("../models/Discipline");

// her-19: bộ môn đọc từ DB (cache 30 giây — studio nhỏ, thêm môn là việc hiếm).
// Dùng cho validate serviceType của lớp/gói và tra label hiển thị.
let cache = { at: 0, list: [] };
const TTL_MS = 30 * 1000;

async function allDisciplines() {
  if (Date.now() - cache.at > TTL_MS) {
    cache = { at: Date.now(), list: await Discipline.find({}).sort({ order: 1, key: 1 }) };
  }
  return cache.list;
}

function clearDisciplineCache() {
  cache = { at: 0, list: [] };
}

// Bộ môn hợp lệ cho LỚP NHÓM (không gồm "pt")
async function isValidClassType(key) {
  return (await allDisciplines()).some((d) => d.key === key);
}

// Loại gói hợp lệ = bộ môn bất kỳ + "pt" (gói PT là loại cố định — Q1 12/08)
async function isValidPackageType(key) {
  if (key === "pt") return true;
  return isValidClassType(key);
}

async function labelOf(key) {
  if (key === "pt") return "PT";
  const d = (await allDisciplines()).find((x) => x.key === key);
  return d ? d.label : key;
}

async function classTypeKeys() {
  return (await allDisciplines()).map((d) => d.key);
}

// Bản SYNC cho chỗ serialize không async được — đọc cache hiện có (server prewarm lúc boot);
// chưa có trong cache thì fallback nhãn quen thuộc rồi tới chính key.
const FALLBACK_LABELS = { gym: "Gym", pilates: "Pilates", yoga: "Yoga", pt: "PT" };
function labelOfSync(key) {
  if (key === "pt") return "PT";
  const d = cache.list.find((x) => x.key === key);
  return d ? d.label : FALLBACK_LABELS[key] || key;
}

module.exports = { allDisciplines, isValidClassType, isValidPackageType, labelOf, labelOfSync, classTypeKeys, clearDisciplineCache };
