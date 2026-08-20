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

// Bộ môn hợp lệ trong danh mục (dùng chung cho lớp nhóm và loại gói)
async function isValidClassType(key) {
  return (await allDisciplines()).some((d) => d.key === key);
}

// her-35: loại gói = bộ môn trong danh mục, không còn loại "pt"
async function isValidPackageType(key) {
  return isValidClassType(key);
}

async function labelOf(key) {
  const d = (await allDisciplines()).find((x) => x.key === key);
  return d ? d.label : key;
}

async function classTypeKeys() {
  return (await allDisciplines()).map((d) => d.key);
}

// Bản SYNC cho chỗ serialize không async được — đọc cache hiện có (server prewarm lúc boot);
// chưa có trong cache thì fallback nhãn quen thuộc rồi tới chính key.
const FALLBACK_LABELS = { gym: "Gym", boxing: "Boxing", stretching: "Stretching", pilates: "Pilates", yoga: "Yoga" };
function labelOfSync(key) {
  const d = cache.list.find((x) => x.key === key);
  return d ? d.label : FALLBACK_LABELS[key] || key;
}

module.exports = { allDisciplines, isValidClassType, isValidPackageType, labelOf, labelOfSync, classTypeKeys, clearDisciplineCache };
