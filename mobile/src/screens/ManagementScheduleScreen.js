import { useState, useCallback, useEffect, useRef } from "react";
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import TopBar from "../components/TopBar";
import AppButton from "../components/AppButton";
import SectionLabel from "../components/SectionLabel";
import TimeRow from "../components/TimeRow";
import RosterSheet from "../components/RosterSheet";
import FormSheet from "../components/FormSheet";
import ConfirmSheet from "../components/ConfirmSheet";
import DateTimeField from "../components/DateTimeField";
import { api } from "../api/client";
import { parseQuickDateTime } from "../utils/quickDateTime";
import { syncReminders } from "../utils/reminders";
import { TRAINER_SELF_FORMATS } from "../utils/formats";
import { classTitle } from "../utils/displayName";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../theme";

// Màn "Lịch dạy" của HLV. Từ her-21 quầy đã có màn "Lịch tập" gộp riêng
// (ScheduleBuilderScreen) — file này chỉ còn vai HLV; her-24 làm lại theo cùng phong cách:
// mỗi BUỔI gộp 1 dòng, điểm danh qua DANH SÁCH KHÁCH, ô tìm theo bộ môn/lớp.
// her-35 (19/08): mọi buổi tập đều là 1 lớp có loại hình 1:1/1:2/1:4/1:8 — HLV tự mở buổi
// 1:1/1:2 cho chính mình (luật thật ở server).

function fmtTime(d) {
  return new Date(d).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}
function durationOf(b) {
  const m = Math.round((new Date(b.endAt) - new Date(b.startAt)) / 60000);
  return m > 0 ? `${m}'` : "";
}
function dayLabel(d) {
  const date = new Date(d);
  const wd = date.toLocaleDateString("vi-VN", { weekday: "long" });
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${wd} ${dd}/${mm}`;
}

// Gom danh sách theo ngày để hiện tiêu đề "THỨ BẢY 16/08" như bản thiết kế
function groupByDay(items) {
  const groups = [];
  const byKey = {};
  for (const it of items) {
    const key = new Date(it.startAt).toDateString();
    if (!byKey[key]) {
      byKey[key] = { key, label: dayLabel(it.startAt), items: [] };
      groups.push(byKey[key]);
    }
    byKey[key].items.push(it);
  }
  return groups;
}

// HLV: Hôm nay / Tuần này ("Tuần này" lấy range sắp tới rồi lọc 7 ngày) / Lịch sử.
// her-25: "Tất cả" đổi thành "Lịch sử" — chỉ buổi đã qua, ngày gần nhất lên đầu (chốt 16/08)
const TABS = [
  ["today", "Hôm nay"],
  ["week", "Tuần này"],
  ["past", "Lịch sử"],
];
const RANGE = { today: "today", week: "upcoming", past: "past" };
// Buổi HLV tự mở mặc định 60 phút (giống màn Lịch tập của quầy)
const DEFAULT_DURATION_MINUTES = 60;

export default function ManagementScheduleScreen() {
  const { user } = useAuth();
  const { c } = useTheme();
  const [tab, setTab] = useState("today");
  // her-24: ô tìm lọc DANH SÁCH BUỔI ngay khi gõ — theo bộ môn / tên lớp (như màn Lịch tập)
  const [search, setSearch] = useState("");
  const [bookings, setBookings] = useState([]);
  const [disciplines, setDisciplines] = useState([]); // [[key, label]] — để "yoga" khớp cả nhãn
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState(null);
  // Sheet danh sách khách của 1 buổi: { classId }
  const [roster, setRoster] = useState(null);
  // her-35: buổi của CHÍNH HLV (kể cả buổi chưa có khách) + sheet mở/sửa buổi
  const [myClasses, setMyClasses] = useState([]);
  // Chuyên môn của chính HLV — lọc chip bộ môn khi tự mở buổi (rỗng = dạy mọi môn, her-19)
  const [mySpecialties, setMySpecialties] = useState([]);
  const [classSheet, setClassSheet] = useState(null); // { mode: "create" } | { mode: "edit", cls }
  // her-36: name = tên riêng của buổi (tuỳ chọn — bỏ trống thì server lấy tên bộ môn)
  const [classForm, setClassForm] = useState({ format: TRAINER_SELF_FORMATS[0], discipline: "", name: "", when: "" });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // her-17: xoá buổi phải xác nhận
  // Phân trang: server trả hasMore, cuộn chạm đáy thì lấy trang kế tiếp nối vào danh sách
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  // Token chống response về muộn đè dữ liệu mới (review her-20 V2)
  const loadSeq = useRef(0);
  // her-26: cuộn chạm đáy tự tải trang kế (reset khi rời đáy để không bắn liên tục);
  // không có nút Tải thêm — trang đầu ngắn chưa tràn màn thì tự tải tiếp cho đến khi cuộn được
  const endReached = useRef(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const viewH = useRef(0);
  const contentH = useRef(0);
  const scrollRef = useRef(null);
  // Tự-lấp lỗi 2 lần liên tiếp thì DỪNG (mạng rớt mà cứ bắn lại là spam server —
  // review her-28 #1); thao tác tay (cuộn/refresh/đổi tab) vẫn thử lại được
  const autoFillFails = useRef(0);
  const load = useCallback(async (t = tab, p = 1) => {
    const seq = ++loadSeq.current;
    // Trang 1 = spinner đầu màn (RefreshControl); trang sau = vòng xoay nhỏ cuối danh sách
    if (p === 1) setLoading(true);
    else setLoadingMore(true);
    try {
      setErrorMsg("");
      // Trang sau chỉ cần thêm booking — không tải lại buổi/danh mục (review her-26 b4)
      if (p > 1) {
        const more = await api.get("/management/bookings", { range: RANGE[t] || "today", page: p, limit: t === "past" ? 20 : 100, mine: 1 });
        if (seq !== loadSeq.current) return;
        setBookings((prev) => {
          const seen = new Set(prev.map((b) => String(b.id)));
          return [...prev, ...more.bookings.filter((b) => !seen.has(String(b.id)))];
        });
        setHasMore(!!more.hasMore);
        setPage(p);
        endReached.current = false;
        return;
      }
      // Buổi của chính HLV — chỉ cần [-1 ngày .. +8 ngày]: màn hiển thị tối đa "Tuần
      // này", kéo cả năm là thừa (her-28). from lùi 1 ngày: buổi ĐANG dạy/vừa qua vẫn còn
      // thông tin số khách (review her-24 a4). Tự mở buổi XA hơn 1 tuần → toast ghi rõ
      // ngày để không tưởng tạo hụt.
      const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const to = new Date(Date.now() + 8 * 24 * 3600 * 1000).toISOString();
      const [res, classesRes, discRes, trainersRes] = await Promise.all([
        // KHÔNG fallback "all": thêm tab mới mà quên khai RANGE thì thà lộ lỗi sớm còn hơn
        // âm thầm trộn quá khứ + tương lai (review her-25). Lịch sử tải từng trang nhỏ (20)
        // cho nhẹ (her-26); tab khác giữ 100 vì booking dựng cả danh sách buổi
        // mine=1 (her-31): màn này là "lịch CỦA TÔI" — HLV server đã ép sẵn, còn ADMIN
        // kiêm HLV vào đây cũng chỉ thấy lịch của chính mình (không phải tự lọc)
        api.get("/management/bookings", { range: RANGE[t] || "today", page: p, limit: t === "past" ? 20 : 100, mine: 1 }),
        api.get("/schedule/classes", { from, to, mine: 1 }),
        api.get("/disciplines"),
        // Chuyên môn của chính mình lấy từ danh sách HLV (mọi tài khoản đọc được);
        // tài khoản chưa có hồ sơ HLV thì khỏi gọi
        user?.trainerId ? api.get("/trainers") : Promise.resolve({ trainers: [] }),
      ]);
      if (seq !== loadSeq.current) return; // đã có lần tải mới hơn
      // Append có DEDUPE theo id — chống lặp bản ghi khi dữ liệu đổi giữa 2 trang (review her-25)
      setBookings((prev) => {
        if (p === 1) return res.bookings;
        const seen = new Set(prev.map((b) => String(b.id)));
        return [...prev, ...res.bookings.filter((b) => !seen.has(String(b.id)))];
      });
      setHasMore(!!res.hasMore);
      setPage(p);
      // Nạp xong 1 trang thì mở khoá — đứng yên ở đáy vẫn tải tiếp được trang kế
      // khi cuộn nhẹ (không còn nút dự phòng — review her-26 b3)
      endReached.current = false;
      autoFillFails.current = 0;
      setMyClasses(classesRes.classes);
      setDisciplines(discRes.disciplines.map((d) => [d.key, d.label]));
      const me = (trainersRes.trainers || []).find((x) => String(x.id) === String(user?.trainerId));
      setMySpecialties(me?.specialties || []);
      // Mục 9: HLV cũng được nhắc trước 1 tiếng các buổi CÓ KHÁCH sắp dạy (no-op trên web).
      // Dùng range "upcoming" độc lập với tab đang xem để không phụ thuộc bộ lọc.
      if (p === 1) {
        api.get("/management/bookings", { range: "upcoming", page: 1, mine: 1 })
          .then((r2) => syncReminders((r2.bookings || []).filter((b) => b.status === "booked")))
          .catch((e) => console.warn("[reminders] không tải được lịch dạy:", e?.message));
      }
    } catch (err) {
      if (seq === loadSeq.current) { setErrorMsg(err.message); autoFillFails.current += 1; }
    } finally {
      // Lần tải cũ không được tắt spinner của lần tải mới đang chạy
      if (seq === loadSeq.current) { setLoading(false); setLoadingMore(false); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useFocusEffect(
    useCallback(() => {
      load(tab);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab])
  );

  // her-26: nội dung chưa tràn màn (chưa cuộn được) mà server còn dữ liệu → tự tải tiếp.
  // Kiểm trong effect (khi loading vừa tắt) — sự kiện đổi kích thước có thể bắn lúc còn
  // đang loading rồi không bắn lại, kiểm tại chỗ sẽ lỡ nhịp
  useEffect(() => {
    if (loading || loadingMore || !hasMore) return;
    if (autoFillFails.current >= 2) return; // lỗi liên tiếp — chờ thao tác tay (review her-28 #1)
    // RN-web không bắn onLayout/onContentSizeChange của ScrollView — đọc thẳng DOM;
    // native dùng số đo từ 2 sự kiện đó
    let ch = contentH.current;
    let vh = viewH.current;
    const node = scrollRef.current?.getScrollableNode?.();
    if (node && typeof node.scrollHeight === "number") {
      ch = node.scrollHeight;
      vh = node.clientHeight;
    }
    if (ch > vh + 40) return;
    load(tab, page + 1);
    // `search` trong deps: gõ tìm làm danh sách ngắn lại thì tự tải tiếp (góp ý 16/08)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, loadingMore, hasMore, page, tab, search]);

  // Đổi tab: ẨN "Tải thêm" + về trang 1 NGAY — nút của tab cũ không được append trang 2
  // vào dữ liệu tab mới (review her-21 V3). useFocusEffect (deps [tab]) tự load.
  const changeTab = (t) => {
    setHasMore(false);
    setPage(1);
    endReached.current = false; // không kẹt khoá từ tab cũ (review her-26 b2)
    setTab(t);
    setLoading(true);
  };

  // Clear timer cũ để toast lỗi không bị toast trước đó "giết non"; unmount thì dọn hẳn
  const toastTimer = useRef(null);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const flash = (msg) => {
    clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  };

  // "Tuần này": lọc thêm 7 ngày tới từ range sắp tới
  const visible = tab === "week"
    ? bookings.filter((b) => new Date(b.startAt) <= new Date(Date.now() + 7 * 24 * 3600 * 1000))
    : bookings;

  // her-35: gộp booking theo BUỔI (classId) — điểm danh qua danh sách khách của buổi
  const classById = Object.fromEntries(myClasses.map((x) => [String(x.id), x]));
  let rows = [];
  const byKey = {};
  for (const b of visible) {
    // Booking cũ thiếu classId thì gộp theo tên + giờ để không vỡ thành nhiều dòng
    const key = `c-${b.classId || `${b.title}|${b.startAt}`}`;
    if (!byKey[key]) {
      byKey[key] = {
        id: key,
        classId: b.classId || null,
        cls: classById[String(b.classId)] || null, // còn trong cửa sổ [-1..+8 ngày] thì có
        title: b.title,
        format: b.format || "",
        coach: b.coach || "", // her-38: dòng đậm có tên HLV ở MỌI vai, kể cả lịch của chính mình
        serviceType: b.serviceType,
        startAt: b.startAt,
        endAt: b.endAt,
        customers: [],
        booked: 0,
        done: 0,
        absent: 0,
        pending: 0, // her-40: completed do sweep tự hoàn tất — CHƯA điểm danh thật
      };
      rows.push(byKey[key]);
    }
    byKey[key].customers.push(b.customer.name);
    byKey[key].booked += 1;
    // her-40 (20/08): "đến" chỉ tính khi có dấu điểm danh THẬT (attendanceAt). Buổi qua giờ
    // được hệ thống tự chuyển "đã tập" (sweep) thì chưa ai điểm danh → "chưa điểm danh".
    if (b.status === "completed") {
      if (b.attendanceAt) byKey[key].done += 1;
      else byKey[key].pending += 1;
    }
    if (b.status === "no_show") byKey[key].absent += 1; // "vắng" luôn do người bấm
  }
  // Buổi của HLV chưa có dòng từ booking (buổi TRỐNG, hoặc buổi có khách mà booking nằm
  // ngoài trang đã tải) + lọc theo tab. Tab Lịch sử: KHÔNG chèn (buổi sắp tới không thuộc
  // lịch sử — her-25)
  if (tab !== "past") {
    const now = new Date();
    const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999);
    const weekEnd = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    for (const cl of myClasses) {
      if (byKey[`c-${cl.id}`]) continue; // đã có dòng gộp từ booking
      const st = new Date(cl.startAt);
      if (st < now) continue;
      if (tab === "today" && st > endOfToday) continue;
      if (tab === "week" && st > weekEnd) continue;
      // Buổi có khách nhưng booking ngoài trang đã tải: vẫn dựng dòng theo SỐ LIỆU LỚP
      // (số khách từ server luôn đúng) — không được để buổi "vô hình" (review her-24 b2);
      // tên khách xem trong danh sách
      rows.push({
        id: `c-${cl.id}`,
        classId: cl.id,
        cls: cl,
        title: cl.name,
        format: cl.format || "",
        coach: cl.coach || "",
        serviceType: cl.serviceType,
        startAt: cl.startAt,
        endAt: cl.endAt,
        customers: [],
        booked: Math.max(cl.capacity - cl.spotsLeft, 0),
        done: 0,
        absent: 0,
        pending: 0,
      });
    }
  }
  // Số khách thật lấy theo MỨC LỚN HƠN giữa booking đã tải và số liệu lớp: booking bị cắt
  // trang thì dòng vẫn không báo thiếu khách (và buổi có khách không lọt vào nhánh sửa/xoá)
  for (const r of rows) {
    if (r.cls) r.booked = Math.max(r.booked, Math.max(r.cls.capacity - r.cls.spotsLeft, 0));
  }
  // Lịch sử GIỮ thứ tự server (mới nhất trước, tải thêm nối phần cũ xuống dưới — her-25);
  // các tab tương lai sắp tăng dần theo giờ
  if (tab !== "past") rows.sort((a, b) => new Date(a.startAt) - new Date(b.startAt));

  // her-24: lọc theo chuỗi tìm — khớp tên lớp / bộ môn (key + nhãn tiếng Việt),
  // không phân biệt hoa thường/dấu; nhiều từ = mọi từ đều phải khớp
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d");
  const words = norm(search.trim()).split(/\s+/).filter(Boolean);
  if (words.length) {
    const labelOf = Object.fromEntries(disciplines);
    rows = rows.filter((r) => {
      // Tên khách cũng khớp — chip đang hiện ngay trên dòng (review her-24 a6)
      const hay = [r.title, r.serviceType, labelOf[r.serviceType], ...r.customers].map(norm).join(" ");
      return words.every((w) => hay.includes(w));
    });
  }

  // her-38: loại hình đã lên dòng đậm → dòng phụ chỉ còn tình trạng khách (+ điểm danh)
  const metaOf = (r) => {
    const parts = [r.booked > 0 ? `${r.booked} khách` : "còn trống"];
    if (r.done) parts.push(`${r.done} đến`);
    if (r.absent) parts.push(`${r.absent} vắng`);
    // her-40: buổi ĐÃ KẾT THÚC còn khách chưa điểm danh — nhắc HLV điểm danh bù
    if (r.pending && new Date(r.endAt) < new Date()) parts.push(`${r.pending} chưa điểm danh`);
    return parts.join(" · ");
  };

  const sections = groupByDay(rows);

  // Buổi TRỐNG loại 1:1/1:2 của mình thì tự sửa/xoá được — buổi đã có khách hoặc loại hình
  // khác phải qua quầy (luật thật ở server)
  const canManage = (r) => r.booked === 0 && !!r.cls && TRAINER_SELF_FORMATS.includes(r.cls.format);

  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtWhen = (d) => {
    const t = new Date(d);
    const year = t.getFullYear() !== new Date().getFullYear() ? `/${t.getFullYear()}` : "";
    return `${pad2(t.getDate())}/${pad2(t.getMonth() + 1)}${year} ${pad2(t.getHours())}:${pad2(t.getMinutes())}`;
  };
  const closeAllSheets = () => {
    setClassSheet(null);
    setConfirmDelete(null);
    setRoster(null);
  };
  const openRoster = (r) => {
    if (!r.classId) return;
    closeAllSheets();
    setRoster({ classId: r.classId });
  };

  // Bộ môn HLV được chọn khi tự mở buổi = chuyên môn của chính mình (chưa khai chuyên môn
  // thì dạy được mọi môn — her-19)
  const myDisciplines = disciplines.filter(([k]) => !mySpecialties.length || mySpecialties.includes(k));

  const openClassSheet = (target) => {
    closeAllSheets();
    setClassForm(
      target.mode === "edit"
        // Sửa: không đổi bộ môn (hàng chip ẩn, body PATCH không gửi) — khỏi gán thừa
        ? { format: target.cls.format, name: target.cls.name || "", when: fmtWhen(target.cls.startAt) }
        : { format: TRAINER_SELF_FORMATS[0], discipline: myDisciplines[0]?.[0] || "", name: "", when: "" }
    );
    setFormError("");
    setClassSheet(target);
  };
  const saveClass = async () => {
    if (saving || !classSheet) return;
    if (!TRAINER_SELF_FORMATS.includes(classForm.format)) return setFormError("Chọn loại hình");
    if (classSheet.mode === "create" && !classForm.discipline) return setFormError("Chọn bộ môn");
    if (!classForm.when) return setFormError("Chưa chọn ngày giờ — bấm ô \"Chọn ngày giờ\"");
    const parsed = parseQuickDateTime(classForm.when);
    if (parsed.error) return setFormError(parsed.error);
    const startAt = parsed.date.toISOString();
    // Buổi mới mặc định 60'; sửa thì giữ thời lượng cũ
    const duration = classSheet.mode === "edit"
      ? new Date(classSheet.cls.endAt) - new Date(classSheet.cls.startAt)
      : DEFAULT_DURATION_MINUTES * 60 * 1000;
    const endAt = new Date(parsed.date.getTime() + duration).toISOString();
    setFormError("");
    // her-36: tên riêng là tuỳ chọn — bỏ trống thì server lấy nhãn bộ môn
    const typedName = (classForm.name || "").trim();
    setSaving(true);
    try {
      if (classSheet.mode === "edit") {
        const body = { startAt, endAt };
        // Chỉ gửi loại hình khi THẬT SỰ đổi — sức chứa do server gán theo loại hình (her-35)
        if (classForm.format !== classSheet.cls.format) body.format = classForm.format;
        // Chỉ gửi tên khi thật sự đổi; xoá trống = gửi rỗng, server đặt lại tên bộ môn
        if (typedName !== (classSheet.cls.name || "")) body.name = typedName;
        await api.patch(`/schedule/classes/${classSheet.cls.id}`, body);
        flash("Đã cập nhật buổi tập");
      } else {
        await api.post("/schedule/classes", {
          ...(typedName ? { name: typedName } : {}),
          format: classForm.format,
          serviceType: classForm.discipline,
          coachId: user.trainerId, // HLV chỉ mở buổi cho CHÍNH MÌNH (server chặn)
          startAt,
          endAt,
        });
        // Ghi rõ ngày — buổi xa hơn "Tuần này" không hiện trên màn, kẻo tưởng tạo hụt (her-28)
        flash(`Đã mở buổi ${typedName ? `${typedName} · ` : ""}${classForm.format} ${classForm.when}`);
      }
      setClassSheet(null);
      load(tab);
    } catch (err) {
      setFormError(err.message); // hiện trong sheet — không để lỗi chìm sau Modal (L8)
    } finally {
      setSaving(false);
    }
  };
  const removeClass = async (id) => {
    if (saving) return;
    setSaving(true);
    try {
      await api.delete(`/schedule/classes/${id}`);
      load(tab);
    } catch (err) {
      flash(err.message);
      // Xoá fail thường vì buổi VỪA có khách đặt — tải lại để dòng "còn trống" stale
      // đổi thành dòng có khách (review her-24 c3)
      load(tab);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TopBar title="Lịch dạy" />

      <View style={{ paddingHorizontal: 22 }}>
        {/* her-24: lọc buổi ngay khi gõ — như màn Lịch tập của quầy */}
        <View style={[styles.searchBox, { backgroundColor: c.card, borderColor: c.line }]}>
          <Feather name="search" size={14} color={c.inkSoft} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Tìm bộ môn, lớp, tên khách"
            placeholderTextColor={c.inkSoft}
            style={[styles.searchInput, { color: c.ink }]}
            returnKeyType="search"
          />
        </View>

        <View style={[styles.tabs, { borderBottomColor: c.line }]}>
          {TABS.map(([key, label]) => (
            <TouchableOpacity
              key={key}
              onPress={() => changeTab(key)}
              style={[styles.tabBtn, tab === key && { borderBottomWidth: 2.5, borderBottomColor: c.accent }]}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                {key === "past" && (
                  <Feather name="clock" size={12} color={tab === key ? c.accent : c.inkSoft} />
                )}
                <Text style={[styles.tabLabel, { color: tab === key ? c.accent : c.inkSoft }]}>{label}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {!!errorMsg && <Text style={[styles.error, { color: c.danger }]}>{errorMsg}</Text>}

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(tab)} tintColor={c.accent} />}
        // her-26: lướt xuống cuối là tự tải trang lịch sử kế tiếp — không bắt bấm nút
        scrollEventThrottle={100}
        onScroll={({ nativeEvent: { layoutMeasurement, contentOffset, contentSize } }) => {
          // Danh sách ngắn hơn màn thì bounce/kéo-làm-mới cũng "chạm đáy" — bỏ qua,
          // ca đó đã có effect tự tải lo (review her-26 b1)
          if (contentSize.height <= layoutMeasurement.height || contentOffset.y <= 0) return;
          const nearBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 400;
          if (!nearBottom) { endReached.current = false; return; }
          if (endReached.current || loading || loadingMore || !hasMore) return;
          endReached.current = true;
          load(tab, page + 1);
        }}
        onLayout={(e) => { viewH.current = e.nativeEvent.layout.height; }}
        onContentSizeChange={(w, h) => { contentH.current = h; }}
      >
        {sections.length === 0 && !loading && (
          <Text style={[styles.empty, { color: c.inkSoft }]}>
            {words.length && hasMore ? "Đang tìm trong lịch sử..." : "Không có lịch nào phù hợp."}
          </Text>
        )}

        {sections.map((sec) => (
          <View key={sec.key}>
            <SectionLabel>{sec.label}</SectionLabel>

            {sec.items.map((r, i) => (
              <TimeRow
                key={r.id}
                time={fmtTime(r.startAt)}
                sub={durationOf(r)}
                title={classTitle(r)}
                meta={metaOf(r)}
                last={i === sec.items.length - 1}
              >
                {canManage(r) ? (
                  <View style={{ flexDirection: "row", gap: 16 }}>
                    <TouchableOpacity disabled={saving} hitSlop={8} onPress={() => openClassSheet({ mode: "edit", cls: r.cls })}>
                      <Text style={[styles.rosterLink, { color: c.accent }]}>Sửa</Text>
                    </TouchableOpacity>
                    <TouchableOpacity disabled={saving} hitSlop={8} onPress={() => { closeAllSheets(); setConfirmDelete(r.cls); }}>
                      <Text style={[styles.rosterLink, { color: c.inkSoft }]}>Xoá buổi</Text>
                    </TouchableOpacity>
                  </View>
                ) : r.customers.length || r.booked ? (
                  <View>
                    {/* Chip tên khách để nhìn nhanh không cần mở danh sách (mẫu 13) */}
                    <View style={styles.chipWrap}>
                      {r.customers.slice(0, 2).map((n, j) => (
                        <View key={j} style={[styles.chip, { backgroundColor: c.primaryTint }]}>
                          <Text style={[styles.chipText, { color: c.accent }]}>{n}</Text>
                        </View>
                      ))}
                      {r.customers.length > 2 && (
                        <View style={[styles.chip, { backgroundColor: c.primaryTint }]}>
                          <Text style={[styles.chipText, { color: c.accent }]}>+{r.customers.length - 2}</Text>
                        </View>
                      )}
                    </View>
                    {/* her-24: mọi buổi điểm danh qua danh sách khách — hết nút rời trên dòng */}
                    {!!r.classId && r.booked > 0 && (
                      <AppButton variant="outline" style={styles.attendBtn} onPress={() => openRoster(r)}>
                        Điểm danh · Danh sách khách
                      </AppButton>
                    )}
                  </View>
                ) : null /* buổi trống loại khác 1:1/1:2 (quầy xếp): không chừa khối rỗng */}
              </TimeRow>
            ))}
          </View>
        ))}

        {/* her-26: không còn nút Tải thêm — cuộn là tự tải, chỉ hiện vòng xoay khi đang tải */}
        {loadingMore && <ActivityIndicator style={{ marginTop: 16 }} color={c.accent} />}
      </ScrollView>

      {/* Mục 6: HLV tự mở buổi 1:1/1:2 của mình — nút nổi như màn Lịch tập */}
      {!!user?.trainerId && (
        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.fab, { backgroundColor: c.card }]}
          onPress={() => openClassSheet({ mode: "create" })}
        >
          <Feather name="plus" size={24} color={c.accent} />
        </TouchableOpacity>
      )}

      <FormSheet
        visible={!!classSheet}
        title={classSheet?.mode === "edit" ? "Sửa buổi của tôi" : "Mở buổi mới"}
        onClose={() => { if (!saving) setClassSheet(null); }}
      >
        {/* her-35: HLV chỉ tự mở buổi 1:1 / 1:2 (server chặn loại khác) */}
        <SectionLabel style={styles.sheetLabel}>Loại hình</SectionLabel>
        <View style={styles.formChipWrap}>
          {TRAINER_SELF_FORMATS.map((key) => (
            <TouchableOpacity
              key={key}
              onPress={() => setClassForm((f) => ({ ...f, format: key }))}
              style={[
                styles.formChip,
                { borderColor: c.line },
                classForm.format === key && { backgroundColor: c.primaryTint, borderColor: c.primaryTint },
              ]}
            >
              <Text style={[styles.formChipText, { color: classForm.format === key ? c.accent : c.ink }]}>{key}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Bộ môn = chuyên môn của chính HLV; sửa buổi thì giữ nguyên bộ môn (đổi môn nhờ quầy) */}
        {classSheet?.mode !== "edit" && (
          <>
            <SectionLabel style={styles.sheetLabel}>Bộ môn</SectionLabel>
            <View style={styles.formChipWrap}>
              {myDisciplines.map(([key, label]) => (
                <TouchableOpacity
                  key={key}
                  onPress={() => setClassForm((f) => ({ ...f, discipline: key }))}
                  style={[
                    styles.formChip,
                    { borderColor: c.line },
                    classForm.discipline === key && { backgroundColor: c.primaryTint, borderColor: c.primaryTint },
                  ]}
                >
                  <Text style={[styles.formChipText, { color: classForm.discipline === key ? c.accent : c.ink }]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
              {myDisciplines.length === 0 && (
                <Text style={{ fontSize: 12, color: c.inkSoft }}>Chưa có bộ môn — kiểm tra kết nối</Text>
              )}
            </View>
          </>
        )}

        {/* her-36: đặt tên riêng cho buổi (tuỳ chọn) — buổi đã có khách không vào được sheet này */}
        <SectionLabel style={styles.sheetLabel}>Tên lớp</SectionLabel>
        <TextInput
          value={classForm.name}
          onChangeText={(v) => setClassForm((f) => ({ ...f, name: v }))}
          placeholder="Bỏ trống = tên bộ môn"
          placeholderTextColor={c.inkSoft}
          maxLength={100}
          style={[styles.input, { borderBottomColor: c.line, color: c.ink }]}
        />

        <SectionLabel style={styles.sheetLabel}>Ngày giờ</SectionLabel>
        {/* Mục 11: bộ chọn lịch + giờ thay ô gõ tay */}
        <DateTimeField value={classForm.when} onChange={(v) => setClassForm((f) => ({ ...f, when: v }))} />
        {!!formError && <Text style={[styles.formError, { color: c.danger }]}>{formError}</Text>}
        <AppButton style={{ marginTop: 22 }} disabled={saving} onPress={saveClass}>
          {saving ? "Đang lưu..." : classSheet?.mode === "edit" ? "Lưu thay đổi" : "Mở buổi"}
        </AppButton>
      </FormSheet>

      <ConfirmSheet
        visible={!!confirmDelete}
        busy={saving}
        title="Xoá buổi?"
        message={
          confirmDelete
            ? `Bạn chắc chắn muốn xoá buổi ${fmtTime(confirmDelete.startAt)} ${dayLabel(confirmDelete.startAt)}? Thao tác không thể hoàn tác.`
            : ""
        }
        confirmLabel="Xoá buổi"
        onConfirm={async () => {
          if (!confirmDelete) return;
          await removeClass(confirmDelete.id);
          setConfirmDelete(null);
        }}
        onClose={() => setConfirmDelete(null)}
      />

      {/* HLV: chỉ Đến/Vắng — không Bỏ, không hủy hộ, KHÔNG thêm học viên (her-39).
          ADMIN kiêm HLV dùng chung màn này thì giữ ĐỦ quyền như ở tab Lịch tập
          (review her-31 b — server vốn cho phép, UI yếu hơn quyền thật chỉ gây khó hiểu) */}
      <RosterSheet
        classId={roster?.classId}
        canClear={user?.role === "admin"}
        canCancel={user?.role === "admin"}
        canAdd={user?.role === "admin"}
        onChanged={() => load(tab)}
        onClose={() => setRoster(null)}
      />

      {!!toast && (
        <View style={[styles.toast, { backgroundColor: c.accent }]}>
          <Feather name="info" size={14} color="#fff" />
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 4,
  },
  searchInput: { flex: 1, fontSize: 13.5 },
  tabs: { flexDirection: "row", gap: 20, borderBottomWidth: 1, marginTop: 14 },
  tabBtn: { paddingBottom: 9 },
  tabLabel: { fontSize: 13, fontWeight: "700" },
  error: { fontSize: 12.5, marginHorizontal: 22, marginTop: 10, fontWeight: "700" },
  empty: { fontSize: 13, marginTop: 18 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  chipText: { fontSize: 11.5, fontWeight: "700" },
  attendBtn: { alignSelf: "stretch", marginTop: 10 },
  rosterLink: { fontSize: 11.5, fontWeight: "700" },
  toast: {
    position: "absolute",
    bottom: 20,
    left: 22,
    right: 22,
    borderRadius: 999,
    paddingVertical: 11,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  toastText: { color: "#fff", fontSize: 12.5, flex: 1 },
  // FAB chỉ icon "+" — tròn, nhích lên khỏi mép dưới (góp ý 18/08)
  fab: {
    position: "absolute",
    right: 22,
    bottom: 34,
    width: 54,
    height: 54,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  // Chip chọn trong form (loại hình / bộ môn) — cùng kiểu với màn Lịch tập
  sheetLabel: { marginTop: 12 },
  formChipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  formChip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5 },
  formChipText: { fontSize: 12.5, fontWeight: "700" },
  // Ô nhập gạch chân — cùng kiểu với các form khác của app (her-36)
  input: { borderBottomWidth: 1.5, paddingVertical: 8, fontSize: 15, marginTop: 2 },
  formError: { fontSize: 12.5, fontWeight: "700", marginTop: 14 },
});
