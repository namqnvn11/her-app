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
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../theme";

// Màn "Lịch dạy" của HLV. Từ her-21 quầy đã có màn "Lịch tập" gộp riêng
// (ScheduleBuilderScreen) — file này chỉ còn vai HLV; her-24 làm lại theo cùng phong cách:
// PT nhóm gộp 1 dòng theo khung, điểm danh qua DANH SÁCH KHÁCH, ô tìm theo bộ môn/lớp.

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
  // Sheet danh sách khách của 1 buổi: { classId } (lớp group) | { slotId } (khung PT)
  const [roster, setRoster] = useState(null);
  // Mục 6: HLV tự mở khung PT — danh sách khung của mình + sheet tạo/sửa
  const [mySlots, setMySlots] = useState([]);
  const [slotSheet, setSlotSheet] = useState(null); // { mode: "create" } | { mode: "edit", slot }
  const [slotForm, setSlotForm] = useState({ when: "", capacity: "1" });
  const [slotError, setSlotError] = useState("");
  const [slotBusy, setSlotBusy] = useState(false);
  const [confirmDeleteSlot, setConfirmDeleteSlot] = useState(null); // her-17: xoá khung phải xác nhận
  // Phân trang: server trả hasMore, bấm "Tải thêm" để lấy trang kế tiếp nối vào danh sách
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
      // Trang sau chỉ cần thêm booking — không tải lại khung/danh mục (review her-26 b4)
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
      // Khung PT của chính HLV — chỉ cần [-1 ngày .. +8 ngày]: màn hiển thị tối đa "Tuần
      // này", kéo cả năm là thừa (her-28). from lùi 1 ngày: buổi ĐANG dạy/vừa qua vẫn còn
      // thông tin x/y khách (review her-24 a4). Tự mở khung XA hơn 1 tuần → toast ghi rõ
      // ngày để không tưởng tạo hụt.
      const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const to = new Date(Date.now() + 8 * 24 * 3600 * 1000).toISOString();
      const [res, slotsRes, discRes] = await Promise.all([
        // KHÔNG fallback "all": thêm tab mới mà quên khai RANGE thì thà lộ lỗi sớm còn hơn
        // âm thầm trộn quá khứ + tương lai (review her-25). Lịch sử tải từng trang nhỏ (20)
        // cho nhẹ (her-26); tab khác giữ 100 vì booking dựng cả danh sách buổi
        // mine=1 (her-31): màn này là "lịch CỦA TÔI" — HLV server đã ép sẵn, còn ADMIN
        // kiêm HLV vào đây cũng chỉ thấy lịch của chính mình (không phải tự lọc)
        api.get("/management/bookings", { range: RANGE[t] || "today", page: p, limit: t === "past" ? 20 : 100, mine: 1 }),
        api.get("/schedule/pt-slots", { from, to, mine: 1 }),
        api.get("/disciplines"),
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
      setMySlots(slotsRes.slots);
      setDisciplines(discRes.disciplines.map((d) => [d.key, d.label]));
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

  // her-24: gộp theo BUỔI — lớp group theo classId, PT (cả 1:1 lẫn nhóm) theo slotId;
  // điểm danh chuyển hết vào danh sách khách của buổi (đồng bộ với màn Lịch tập của quầy)
  const slotById = Object.fromEntries(mySlots.map((s) => [String(s.id), s]));
  let rows = [];
  const byKey = {};
  for (const b of visible) {
    const key = b.type === "group"
      ? `c-${b.classId || `${b.title}|${b.startAt}`}`
      : `s-${b.slotId || `${b.title}|${b.startAt}`}`;
    if (!byKey[key]) {
      byKey[key] = {
        id: key,
        type: b.type,
        classId: b.type === "group" ? b.classId : null,
        slotId: b.type === "pt" ? b.slotId : null,
        title: b.type === "group" ? b.title : ((b.title || "").startsWith("PT nhóm") ? "PT nhóm" : "PT 1:1"),
        serviceType: b.serviceType,
        startAt: b.startAt,
        endAt: b.endAt,
        slot: b.type === "pt" ? slotById[String(b.slotId)] : null, // còn trong cửa sổ [-1..+8 ngày] thì có
        customers: [],
        done: 0,
        absent: 0,
      };
      rows.push(byKey[key]);
    }
    byKey[key].customers.push(b.customer.name);
    if (b.status === "completed") byKey[key].done += 1;
    if (b.status === "no_show") byKey[key].absent += 1;
  }
  // Khung PT CHƯA CÓ booking nào (trống hoàn toàn) + lọc theo tab — khung đã có khách
  // hiện qua dòng gộp ở trên (kèm "còn nhận thêm" nếu chưa kín).
  // Tab Lịch sử: KHÔNG chèn khung (khung là buổi tương lai, không thuộc lịch sử — her-25)
  if (tab !== "past") {
    const now = new Date();
    const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999);
    const weekEnd = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    for (const sl of mySlots) {
      if (byKey[`s-${sl.id}`]) continue; // đã có dòng gộp từ booking
      const st = new Date(sl.startAt);
      if (st < now) continue;
      if (tab === "today" && st > endOfToday) continue;
      if (tab === "week" && st > weekEnd) continue;
      if (sl.bookedCount > 0) {
        // Có khách nhưng booking nằm ngoài trang đã tải: vẫn dựng dòng theo SỐ LIỆU SLOT
        // (x/y từ server luôn đúng) + nút danh sách — không được để buổi "vô hình"
        // (review her-24 b2); tên khách xem trong danh sách
        rows.push({
          id: `slot-${sl.id}`,
          type: "pt",
          slotId: sl.id,
          title: sl.capacity > 1 ? "PT nhóm" : "PT 1:1",
          serviceType: "pt",
          slot: sl,
          startAt: sl.startAt,
          endAt: sl.endAt,
          customers: [],
          done: 0,
          absent: 0,
        });
        continue;
      }
      rows.push({
        id: `slot-${sl.id}`,
        type: "slot",
        title: "Khung trống — chờ khách đặt",
        serviceType: "pt",
        slot: sl,
        startAt: sl.startAt,
        endAt: sl.endAt,
        customers: [],
        done: 0,
        absent: 0,
      });
    }
  }
  // Lịch sử GIỮ thứ tự server (mới nhất trước, "Tải thêm" nối phần cũ xuống dưới — her-25);
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

  const metaOf = (r) => {
    const parts = [];
    if (r.type === "group") parts.push(`Group · ${r.customers.length} khách`);
    else if (r.type === "slot") parts.push(r.slot.capacity > 1 ? `PT nhóm · 0/${r.slot.capacity} khách` : "PT 1:1 · còn trống");
    else if (r.slot) parts.push(`${r.slot.bookedCount}/${r.slot.capacity} khách${r.slot.bookedCount < r.slot.capacity ? " · còn nhận thêm" : ""}`);
    else parts.push(`${r.customers.length} khách`);
    if (r.done) parts.push(`${r.done} đến`);
    if (r.absent) parts.push(`${r.absent} vắng`);
    return parts.join(" · ");
  };

  const sections = groupByDay(rows);

  // Mục 6: HLV tự mở/sửa/xoá khung PT của mình — luật thật ở server (chỉ khung mình + trống)
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtWhen = (d) => {
    const t = new Date(d);
    const year = t.getFullYear() !== new Date().getFullYear() ? `/${t.getFullYear()}` : "";
    return `${pad2(t.getDate())}/${pad2(t.getMonth() + 1)}${year} ${pad2(t.getHours())}:${pad2(t.getMinutes())}`;
  };
  const closeAllSheets = () => {
    setSlotSheet(null);
    setConfirmDeleteSlot(null);
    setRoster(null);
  };
  const openRoster = (r) => {
    if (!r.classId && !r.slotId) return;
    closeAllSheets();
    setRoster(r.classId ? { classId: r.classId } : { slotId: r.slotId });
  };

  const openSlotSheet = (target) => {
    closeAllSheets();
    setSlotForm(
      target.mode === "edit"
        ? { when: fmtWhen(target.slot.startAt), capacity: String(target.slot.capacity) }
        : { when: "", capacity: "1" }
    );
    setSlotError("");
    setSlotSheet(target);
  };
  const saveSlot = async () => {
    if (slotBusy || !slotSheet) return;
    if (!slotForm.when) return setSlotError("Chưa chọn ngày giờ — bấm ô \"Chọn ngày giờ\"");
    const parsed = parseQuickDateTime(slotForm.when);
    if (parsed.error) return setSlotError(parsed.error);
    const cap = Number(slotForm.capacity);
    if (!Number.isInteger(cap) || cap < 1 || cap > 10) {
      return setSlotError("Số người tối đa phải là số nguyên từ 1 đến 10");
    }
    const startAt = parsed.date.toISOString();
    // Khung mới mặc định 60'; sửa thì giữ thời lượng cũ
    const duration = slotSheet.mode === "edit"
      ? new Date(slotSheet.slot.endAt) - new Date(slotSheet.slot.startAt)
      : 60 * 60 * 1000;
    const endAt = new Date(parsed.date.getTime() + duration).toISOString();
    setSlotError("");
    setSlotBusy(true);
    try {
      if (slotSheet.mode === "edit") {
        await api.patch(`/schedule/pt-slots/${slotSheet.slot.id}`, { startAt, endAt, capacity: cap });
        flash("Đã cập nhật khung giờ");
      } else {
        await api.post("/schedule/pt-slots", { trainerId: user.trainerId, startAt, endAt, capacity: cap });
        // Ghi rõ ngày — khung xa hơn "Tuần này" không hiện trên màn, kẻo tưởng tạo hụt (her-28)
        flash(`${cap > 1 ? "Đã mở khung PT nhóm" : "Đã mở khung PT 1:1"} ${slotForm.when}`);
      }
      setSlotSheet(null);
      load(tab);
    } catch (err) {
      setSlotError(err.message); // hiện trong sheet — không để lỗi chìm sau Modal (L8)
    } finally {
      setSlotBusy(false);
    }
  };
  const removeSlot = async (id) => {
    if (slotBusy) return;
    setSlotBusy(true);
    try {
      await api.delete(`/schedule/pt-slots/${id}`);
      load(tab);
    } catch (err) {
      flash(err.message);
      // Xoá fail thường vì khung VỪA có khách đặt — tải lại để dòng "Khung trống" stale
      // đổi thành dòng có khách (review her-24 c3)
      load(tab);
    } finally {
      setSlotBusy(false);
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
            placeholder="Tìm theo bộ môn, lớp hoặc tên khách"
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
              style={[styles.tabBtn, tab === key && { borderBottomWidth: 2.5, borderBottomColor: c.primary }]}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                {key === "past" && (
                  <Feather name="clock" size={12} color={tab === key ? c.primary : c.inkSoft} />
                )}
                <Text style={[styles.tabLabel, { color: tab === key ? c.primary : c.inkSoft }]}>{label}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {!!errorMsg && <Text style={[styles.error, { color: c.danger }]}>{errorMsg}</Text>}

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(tab)} tintColor={c.primary} />}
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
                title={r.title}
                meta={metaOf(r)}
                last={i === sec.items.length - 1}
              >
                {r.type === "slot" ? (
                  <View style={{ flexDirection: "row", gap: 16 }}>
                    <TouchableOpacity disabled={slotBusy} hitSlop={8} onPress={() => openSlotSheet({ mode: "edit", slot: r.slot })}>
                      <Text style={[styles.rosterLink, { color: c.primary }]}>Sửa</Text>
                    </TouchableOpacity>
                    <TouchableOpacity disabled={slotBusy} hitSlop={8} onPress={() => { closeAllSheets(); setConfirmDeleteSlot(r.slot); }}>
                      <Text style={[styles.rosterLink, { color: c.inkSoft }]}>Xoá khung giờ</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View>
                    {/* Chip tên khách để nhìn nhanh không cần mở danh sách (mẫu 13) */}
                    <View style={styles.chipWrap}>
                      {r.customers.slice(0, 2).map((n, j) => (
                        <View key={j} style={[styles.chip, { backgroundColor: c.primaryTint }]}>
                          <Text style={[styles.chipText, { color: c.primary }]}>{n}</Text>
                        </View>
                      ))}
                      {r.customers.length > 2 && (
                        <View style={[styles.chip, { backgroundColor: c.primaryTint }]}>
                          <Text style={[styles.chipText, { color: c.primary }]}>+{r.customers.length - 2}</Text>
                        </View>
                      )}
                    </View>
                    {/* her-24: PT (cả 1:1) cũng điểm danh qua danh sách khách — hết nút rời trên dòng */}
                    {(r.classId || r.slotId) && (
                      <AppButton variant="outline" style={styles.attendBtn} onPress={() => openRoster(r)}>
                        Điểm danh · Danh sách khách
                      </AppButton>
                    )}
                  </View>
                )}
              </TimeRow>
            ))}
          </View>
        ))}

        {/* her-26: không còn nút Tải thêm — cuộn là tự tải, chỉ hiện vòng xoay khi đang tải */}
        {loadingMore && <ActivityIndicator style={{ marginTop: 16 }} color={c.primary} />}
      </ScrollView>

      {/* Mục 6: HLV tự mở khung PT của mình — nút nổi như màn Lịch tập */}
      {!!user?.trainerId && (
        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.fab, { backgroundColor: c.card }]}
          onPress={() => openSlotSheet({ mode: "create" })}
        >
          <Text style={[styles.fabText, { color: c.primary }]}>+ Mở khung PT</Text>
        </TouchableOpacity>
      )}

      <FormSheet
        visible={!!slotSheet}
        title={slotSheet?.mode === "edit" ? "Sửa khung PT của tôi" : "Mở khung PT mới"}
        onClose={() => { if (!slotBusy) setSlotSheet(null); }}
      >
        <SectionLabel style={{ marginTop: 12 }}>Ngày giờ</SectionLabel>
        {/* Mục 11: bộ chọn lịch + giờ thay ô gõ tay */}
        <DateTimeField value={slotForm.when} onChange={(v) => setSlotForm((f) => ({ ...f, when: v }))} />
        <View style={{ width: 150 }}>
          {/* 1 = PT 1:1; từ 2 trở lên là PT nhóm (tối đa 10) */}
          <SectionLabel style={{ marginTop: 12 }}>Số người tối đa</SectionLabel>
          <TextInput
            value={slotForm.capacity}
            onChangeText={(v) => setSlotForm((f) => ({ ...f, capacity: v }))}
            keyboardType="number-pad"
            style={[styles.slotInput, { borderBottomColor: c.line, color: c.ink }]}
          />
        </View>
        {!!slotError && <Text style={[styles.slotError, { color: c.danger }]}>{slotError}</Text>}
        <AppButton style={{ marginTop: 22 }} disabled={slotBusy} onPress={saveSlot}>
          {slotBusy ? "Đang lưu..." : slotSheet?.mode === "edit" ? "Lưu thay đổi" : "Mở khung giờ"}
        </AppButton>
      </FormSheet>

      <ConfirmSheet
        visible={!!confirmDeleteSlot}
        busy={slotBusy}
        title="Xoá khung giờ?"
        message={
          confirmDeleteSlot
            ? `Bạn chắc chắn muốn xoá khung ${fmtTime(confirmDeleteSlot.startAt)} ${dayLabel(confirmDeleteSlot.startAt)}? Thao tác không thể hoàn tác.`
            : ""
        }
        confirmLabel="Xoá khung giờ"
        onConfirm={async () => {
          if (!confirmDeleteSlot) return;
          await removeSlot(confirmDeleteSlot.id);
          setConfirmDeleteSlot(null);
        }}
        onClose={() => setConfirmDeleteSlot(null)}
      />

      {/* HLV: chỉ Đến/Vắng — không Bỏ, không hủy hộ. ADMIN kiêm HLV dùng chung màn này
          thì giữ ĐỦ quyền như ở tab Lịch tập (review her-31 b — server vốn cho phép,
          UI yếu hơn quyền thật chỉ gây khó hiểu) */}
      <RosterSheet
        classId={roster?.classId}
        slotId={roster?.slotId}
        canClear={user?.role === "admin"}
        canCancel={user?.role === "admin"}
        onChanged={() => load(tab)}
        onClose={() => setRoster(null)}
      />

      {!!toast && (
        <View style={[styles.toast, { backgroundColor: c.primary }]}>
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
  fab: {
    position: "absolute",
    right: 22,
    bottom: 20,
    borderRadius: 999,
    paddingVertical: 13,
    paddingHorizontal: 18,
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  fabText: { fontSize: 13, fontWeight: "800" },
  slotInput: { borderBottomWidth: 1.5, paddingVertical: 8, fontSize: 15, marginTop: 2 },
  slotError: { fontSize: 12.5, fontWeight: "700", marginTop: 14 },
});
