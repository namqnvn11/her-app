import { useState, useCallback, useEffect, useRef } from "react";
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import TopBar from "../components/TopBar";
import AppButton from "../components/AppButton";
import SectionLabel from "../components/SectionLabel";
import TimeRow from "../components/TimeRow";
import FormSheet from "../components/FormSheet";
import DateTimeField from "../components/DateTimeField";
import RosterSheet from "../components/RosterSheet";
import ConfirmSheet from "../components/ConfirmSheet";
import { api } from "../api/client";
import { parseQuickDateTime } from "../utils/quickDateTime";
import { useTheme } from "../theme";

function fmtTime(d) {
  return new Date(d).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}
function dayLabel(d) {
  const date = new Date(d);
  const wd = date.toLocaleDateString("vi-VN", { weekday: "long" });
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${wd} ${dd}/${mm}`;
}
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
// her-21: gom "Lịch khách" + "Xếp lịch" thành 1 tab "Lịch tập" — lọc theo THỜI GIAN,
// lớp group + khung PT trộn chung 1 danh sách theo ngày (chốt 16/08)
// her-25: "Tất cả" (trộn lịch sử + tương lai, dùng lâu không cuộn nổi) đổi thành "Lịch sử" —
// CHỈ buổi đã qua, ngày gần nhất lên đầu rồi lùi dần (chốt 16/08)
const TABS = [
  ["today", "Hôm nay"],
  ["upcoming", "Sắp tới"],
  ["past", "Lịch sử"],
];
// her-19: danh mục bộ môn lấy từ server (DB) — thêm môn mới không phải sửa app.
// Bản thiết kế bỏ ô thời lượng — mọi khung giờ mặc định 60 phút
const DEFAULT_DURATION_MINUTES = 60;

export default function ScheduleBuilderScreen() {
  const { c } = useTheme();
  const [tab, setTab] = useState("today");
  const [trainers, setTrainers] = useState([]);
  const [disciplines, setDisciplines] = useState([]); // [[key, label]] từ /disciplines
  const [classes, setClasses] = useState([]);
  const [ptSlots, setPtSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  // toast: { msg, isError } — lỗi hiện icon/màu riêng, không giống thông báo thành công
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false); // chặn bấm đúp tạo/xoá khung giờ

  // Form tạo khung giờ nằm trong bottom sheet — bấm nút nổi "+ Khung giờ mới" để mở
  const [sheetOpen, setSheetOpen] = useState(false);
  // Sheet SỬA khung (mục 4): {kind:"group"|"pt", item} — khung có khách chỉ đổi được HLV (16/08)
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({ coachId: "", discipline: "pilates", when: "", capacity: "8" });
  const [editError, setEditError] = useState("");
  // Sheet danh sách khách của lớp
  // Danh sách khách của 1 buổi: { classId } (lớp group) | { slotId } (khung PT — her-20)
  const [roster, setRoster] = useState(null);
  // her-17: xoá khung giờ phải qua hộp xác nhận — { kind: "group"|"pt", item } | null
  const [confirmDelete, setConfirmDelete] = useState(null);
  // Lỗi lúc tạo hiện NGAY TRONG sheet — toast ngoài màn bị Modal che mất (L8)
  const [sheetError, setSheetError] = useState("");
  // her-21: loại khung (group/pt) chọn NGAY TRONG form tạo — không còn tab con Lớp/PT
  const [form, setForm] = useState({ kind: "group", discipline: "pilates", coachId: "", when: "", capacity: "8", ptCapacity: "1" });

  // her-21: booking để đếm điểm danh + lịch sử (tab Lịch sử) — kèm token chống response
  // về muộn (review her-20 V2)
  const [bookings, setBookings] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  // her-22: ô tìm lọc DANH SÁCH BUỔI theo bộ môn / tên HLV / tên lớp — lọc ngay khi gõ
  // (client-side, không phân biệt hoa thường/dấu). Màn hiển thị buổi thì tìm theo buổi —
  // tìm theo tên/SĐT học viên ở đây không hợp lý (đính chính 16/08).
  const [search, setSearch] = useState("");
  const loadSeq = useRef(0);
  // her-26: cuộn chạm đáy tự tải trang kế (reset khi rời đáy để không bắn liên tục);
  // không có nút Tải thêm — trang đầu ngắn chưa tràn màn thì tự tải tiếp cho đến khi cuộn được
  const endReached = useRef(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const viewH = useRef(0);
  const contentH = useRef(0);
  const scrollRef = useRef(null);
  // her-28: tab Sắp tới nạp theo CỬA SỔ THỜI GIAN tăng dần (30 ngày/lần, tối đa 366) —
  // không kéo cả năm một lần nữa; cuộn cuối là nới cửa sổ
  const windowRef = useRef(30);
  // Tự-lấp lỗi 2 lần liên tiếp thì DỪNG (mạng rớt mà cứ bắn lại là spam server —
  // review her-28 #1); thao tác tay (cuộn/refresh/đổi tab) vẫn thử lại được
  const autoFillFails = useRef(0);

  const load = useCallback(async (t = tab, p = 1, { quiet = false } = {}) => {
    const seq = ++loadSeq.current;
    // Trang 1 = spinner đầu màn (RefreshControl); trang sau / nới cửa sổ = vòng xoay cuối danh sách
    if (p === 1 && !quiet) setLoading(true);
    else setLoadingMore(true);
    try {
      setErrorMsg("");
      // Trang sau chỉ cần thêm booking — không tải lại HLV/lớp/khung/danh mục (cuộn lịch sử
      // dài mà mỗi trang kéo cả 5 API thì nặng vô ích — review her-26 b4)
      if (p > 1) {
        const more = await api.get("/management/bookings", { range: t, page: p, limit: t === "past" ? 20 : 100 });
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
      // her-28: chỉ nạp tới cửa sổ đang xem (mặc định 30 ngày, cuộn thì nới thêm) — kéo cả
      // 366 ngày một lần vừa chậm vừa thừa. Tạo khung xa hơn cửa sổ → toast ghi RÕ NGÀY
      // để không tưởng tạo hụt (thay cho cách cũ của review her-21 V4).
      // from = ĐẦU hôm nay: buổi sáng nay đã qua vẫn phải hiện trong tab Hôm nay để điểm danh
      const from = new Date(); from.setHours(0, 0, 0, 0);
      const to = new Date(Date.now() + windowRef.current * 24 * 3600 * 1000).toISOString();
      const [trainersRes, classesRes, slotsRes, discRes, bookingsRes] = await Promise.all([
        api.get("/schedule/trainers"),
        api.get("/schedule/classes", { from: from.toISOString(), to }),
        api.get("/schedule/pt-slots", { from: from.toISOString(), to }),
        api.get("/disciplines"),
        // Điểm danh + lịch sử — range theo tab đang xem. Lịch sử tải TỪNG TRANG NHỎ (20)
        // cho nhẹ, cuộn cuối tự tải tiếp (her-26); tab khác giữ 100 vì booking còn dùng
        // để đếm tóm tắt đến/vắng
        api.get("/management/bookings", { range: t, page: p, limit: t === "past" ? 20 : 100 }),
      ]);
      if (seq !== loadSeq.current) return; // đã có lần tải mới hơn (review her-20 V2)
      // Append có DEDUPE theo id: dữ liệu đổi giữa 2 lần "Tải thêm" (offset lệch) có thể
      // trả lặp bản ghi trang trước → khách bị đếm đôi trong dòng gộp (review her-25)
      setBookings((prev) => {
        if (p === 1) return bookingsRes.bookings;
        const seen = new Set(prev.map((b) => String(b.id)));
        return [...prev, ...bookingsRes.bookings.filter((b) => !seen.has(String(b.id)))];
      });
      setHasMore(!!bookingsRes.hasMore);
      setPage(p);
      // Nạp xong 1 trang thì mở khoá — đứng yên ở đáy vẫn tải tiếp được trang kế
      // khi cuộn nhẹ (không còn nút dự phòng — review her-26 b3)
      endReached.current = false;
      autoFillFails.current = 0;
      setTrainers(trainersRes.trainers);
      const discList = discRes.disciplines.map((d) => [d.key, d.label]);
      setDisciplines(discList);
      // review her-19 V5: bộ môn mặc định phải nằm trong danh mục thật
      setForm((f) => (discList.some(([k]) => k === f.discipline) ? f : { ...f, discipline: discList[0]?.[0] || "" }));
      setClasses(classesRes.classes);
      setPtSlots(slotsRes.slots);
      setForm((f) => {
        // review her-19 V6: HLV preselect phải QUA LỌC chuyên môn của bộ môn đang chọn.
        // Đang chọn loại KHUNG PT thì pool là TOÀN BỘ HLV — không thì HLV không có chuyên
        // môn của bộ môn đang treo bị bỏ chọn sau mỗi lần tải lại (review her-21 N5)
        const pool = f.kind === "pt"
          ? trainersRes.trainers
          : trainersRes.trainers.filter(
              (t) => !(t.specialties || []).length || t.specialties.includes(f.discipline)
            );
        return {
          ...f,
          coachId: pool.some((t) => t.id === f.coachId) ? f.coachId : pool[0]?.id || "",
        };
      });
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
  // her-29 (góp ý 17/08 "loading giật vài cái"): nới cửa sổ Sắp tới trong MỘT lượt tải —
  // nới liên tục 30 ngày/bước đến khi GẶP DỮ LIỆU MỚI hoặc chạm maxDays; các bước rỗng
  // payload gần như 0 nên rẻ. Trước đây mỗi lần chạm đáy chỉ +30 → đứng ở đáy là vòng
  // xoay chớp tắt lặp nhiều nhịp.
  const expandUpcoming = async (maxDays) => {
    if (windowRef.current >= maxDays) return; // đã chạm trần — không bật/tắt spinner vô ích
    const seq = ++loadSeq.current;
    setLoadingMore(true);
    try {
      const from = new Date(); from.setHours(0, 0, 0, 0);
      const prevCount = classes.length + ptSlots.length;
      while (windowRef.current < maxDays) {
        windowRef.current = Math.min(windowRef.current + 30, maxDays);
        const to = new Date(Date.now() + windowRef.current * 24 * 3600 * 1000).toISOString();
        const [cr, sr] = await Promise.all([
          api.get("/schedule/classes", { from: from.toISOString(), to }),
          api.get("/schedule/pt-slots", { from: from.toISOString(), to }),
        ]);
        if (seq !== loadSeq.current) return;
        setClasses(cr.classes);
        setPtSlots(sr.slots);
        if (cr.classes.length + sr.slots.length > prevCount) break; // có buổi mới — dừng, hiện ra
      }
      endReached.current = false;
      autoFillFails.current = 0;
    } catch (err) {
      if (seq === loadSeq.current) { setErrorMsg(err.message); autoFillFails.current += 1; }
    } finally {
      if (seq === loadSeq.current) setLoadingMore(false);
    }
  };

  // "Còn dữ liệu để nạp tiếp" theo tab: Lịch sử = còn trang booking; Hôm nay/Sắp tới = còn
  // trang booking (ngày đông >100 lượt — số đến/vắng phải nạp đủ, review her-28 #2) hoặc
  // (Sắp tới) cửa sổ chưa chạm 366 ngày. loadMore là đường nạp chung cho cuộn + tự-lấp.
  const canLoadMore =
    hasMore || (tab === "upcoming" && windowRef.current < 366);
  const loadMore = () => {
    if (hasMore) {
      load(tab, page + 1); // ưu tiên nạp nốt trang booking của cửa sổ hiện tại
    } else {
      expandUpcoming(366); // cuộn tay: quét tới khi gặp lịch mới hoặc hết 1 năm
    }
  };

  useEffect(() => {
    if (loading || loadingMore || !canLoadMore) return;
    if (autoFillFails.current >= 2) return; // lỗi liên tiếp — chờ thao tác tay
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
    // Tự-lấp: Sắp tới chỉ tự quét đến 90 ngày (đang TÌM thì quét hết 366); còn lại đi
    // đường loadMore chung. Chạm trần thì return hẳn — không gọi cho spinner nhấp nháy
    if (!hasMore && tab === "upcoming") {
      const cap = search.trim() ? 366 : 90;
      if (windowRef.current >= cap) return;
      expandUpcoming(cap);
    } else {
      loadMore();
    }
    // `search` trong deps: gõ tìm làm danh sách NGẮN LẠI (mất thanh cuộn) thì effect phải
    // chạy lại để tự tải tiếp — không thì kẹt không cách nào nạp dữ liệu cũ (góp ý 16/08)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, loadingMore, hasMore, page, tab, search]);

  // Đổi tab: ẨN nút "Tải thêm" + về trang 1 NGAY — không thì bấm Tải thêm trong lúc trang 1
  // của tab mới đang bay sẽ APPEND trang 2 vào dữ liệu tab cũ (review her-21 V3).
  // Chỉ setTab — useFocusEffect (deps [tab]) tự load, khỏi bắn 2 request giống nhau
  const changeTab = (t) => {
    setHasMore(false);
    setPage(1);
    endReached.current = false; // không kẹt khoá từ tab cũ (review her-26 b2)
    windowRef.current = 30; // cửa sổ Sắp tới về mặc định
    setTab(t);
    setLoading(true);
  };

  // Clear timer cũ để toast lỗi không bị toast trước đó "giết non" giữa chừng;
  // unmount thì dọn hẳn — tránh setState trên màn đã rời (review her-21 N6)
  const toastTimer = useRef(null);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const flash = (msg, isError = false) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, isError });
    toastTimer.current = setTimeout(() => setToast(null), isError ? 3500 : 2200);
  };

  const pad = (n) => String(n).padStart(2, "0");
  const fmtWhen = (d) => {
    const t = new Date(d);
    // Khung ở năm khác (builder tải 60 ngày tới, vắt qua năm mới) phải in đủ năm —
    // không thì parse lại thành năm nay = quá khứ, không lưu nổi (review her-09 #5)
    const year = t.getFullYear() !== new Date().getFullYear() ? `/${t.getFullYear()}` : "";
    return `${pad(t.getDate())}/${pad(t.getMonth() + 1)}${year} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
  };

  // Mỗi thời điểm chỉ 1 sheet/modal (góp ý 16/08): mở cái mới thì đóng hết cái cũ
  const closeAllSheets = () => {
    setSheetOpen(false);
    setEditTarget(null);
    setRoster(null);
    setConfirmDelete(null);
  };

  const openEdit = (kind, item) => {
    closeAllSheets();
    setEditForm({
      coachId: String(kind === "group" ? item.coachId : item.trainerId),
      discipline: item.serviceType || "pilates",
      when: fmtWhen(item.startAt),
      capacity: String(item.capacity ?? (kind === "pt" ? "1" : "8")),
    });
    setEditError("");
    setEditTarget({ kind, item });
  };

  const saveEdit = async () => {
    if (busy || !editTarget) return;
    const { kind, item } = editTarget;
    const isGroup = kind === "group";
    const locked = isGroup ? item.customerNames.length > 0 : item.bookedCount > 0;
    if (!editForm.coachId) return setEditError("Chọn HLV phụ trách");

    // Số người tối đa của khung PT (mục 6): validate chung cho cả 2 nhánh dưới
    const ptCap = Number(editForm.capacity);
    if (!isGroup && (!Number.isInteger(ptCap) || ptCap < 1 || ptCap > 10)) {
      return setEditError("Số người tối đa phải là số nguyên từ 1 đến 10");
    }
    let body;
    if (locked) {
      // Khung đã có khách: CHỈ đổi HLV (quyết định 16/08) — riêng khung PT quầy còn được
      // nới SỐ NGƯỜI (không giảm dưới số khách đã đặt — server chặn atomic)
      body = isGroup ? { coachId: editForm.coachId } : { trainerId: editForm.coachId, capacity: ptCap };
    } else {
      if (!editForm.when) return setEditError("Chưa chọn ngày giờ — bấm ô \"Chọn ngày giờ\"");
      const parsed = parseQuickDateTime(editForm.when);
      if (parsed.error) return setEditError(parsed.error);
      // Giữ nguyên thời lượng cũ của khung khi dời giờ
      const duration = new Date(item.endAt) - new Date(item.startAt);
      const startAt = parsed.date.toISOString();
      const endAt = new Date(parsed.date.getTime() + duration).toISOString();
      if (isGroup) {
        const cap = Number(editForm.capacity);
        if (!Number.isInteger(cap) || cap < 1 || cap > 100) {
          return setEditError("Sức chứa phải là số nguyên từ 1 đến 100");
        }
        body = { coachId: editForm.coachId, startAt, endAt, capacity: cap };
        // Chỉ gửi bộ môn + tên tự sinh khi bộ môn THAY ĐỔI — lớp cũ tên riêng ("Pilates
        // Reformer") dời giờ không bị âm thầm đổi tên (review her-09 #6)
        if (editForm.discipline !== item.serviceType) {
          body.serviceType = editForm.discipline;
          body.name = disciplines.find(([k]) => k === editForm.discipline)?.[1] || editForm.discipline;
        }
      } else {
        body = { trainerId: editForm.coachId, startAt, endAt, capacity: ptCap };
      }
    }
    setEditError("");
    setBusy(true);
    try {
      await api.patch(isGroup ? `/schedule/classes/${item.id}` : `/schedule/pt-slots/${item.id}`, body);
      flash("Đã cập nhật khung giờ");
      setEditTarget(null);
      load();
    } catch (err) {
      setEditError(err.message); // hiện trong sheet — không để lỗi chìm sau Modal (L8)
    } finally {
      setBusy(false);
    }
  };

  // Kiểm tra chung cho cả 2 loại khung giờ: HLV + ngày giờ (không nhận ngày quá khứ)
  const validateForm = () => {
    if (!form.coachId) {
      setSheetError("Chọn HLV phụ trách trước");
      return null;
    }
    if (!form.when) {
      setSheetError("Chưa chọn ngày giờ — bấm ô \"Chọn ngày giờ\" để chọn trên lịch");
      return null;
    }
    const parsed = parseQuickDateTime(form.when);
    if (parsed.error) {
      setSheetError(parsed.error);
      return null;
    }
    if (form.kind === "group") {
      const cap = Number(form.capacity);
      if (!Number.isInteger(cap) || cap < 1 || cap > 100) {
        setSheetError("Sức chứa phải là số nguyên từ 1 đến 100");
        return null;
      }
    } else {
      const cap = Number(form.ptCapacity);
      if (!Number.isInteger(cap) || cap < 1 || cap > 10) {
        setSheetError("Số người tối đa phải là số nguyên từ 1 đến 10");
        return null;
      }
    }
    setSheetError("");
    return {
      startAt: parsed.date.toISOString(),
      endAt: new Date(parsed.date.getTime() + DEFAULT_DURATION_MINUTES * 60 * 1000).toISOString(),
    };
  };

  const createClass = async () => {
    if (busy) return;
    const range = validateForm();
    if (!range) return;
    setBusy(true);
    try {
      const label = disciplines.find(([k]) => k === form.discipline)?.[1] || form.discipline;
      await api.post("/schedule/classes", {
        // Tên lớp tự sinh theo loại hình (bỏ nhập tay — quyết định 14/08/2026);
        // danh sách hiển thị "Tên lớp · HLV" nên không lặp tên HLV vào đây
        name: label,
        serviceType: form.discipline,
        coachId: form.coachId,
        ...range,
        capacity: Number(form.capacity),
      });
      // Ghi rõ ngày — khung xa hơn cửa sổ đang xem chưa hiện ngay, kẻo tưởng tạo hụt (her-28)
      flash(`Đã tạo khung giờ Group ${form.when}`);
      setForm((f) => ({ ...f, when: "" }));
      setSheetOpen(false);
      load();
    } catch (err) {
      setSheetError(err.message); // hiện trong sheet — không để lỗi chìm sau Modal
    } finally {
      setBusy(false);
    }
  };

  const createSlot = async () => {
    if (busy) return;
    const range = validateForm();
    if (!range) return;
    setBusy(true);
    try {
      await api.post("/schedule/pt-slots", {
        trainerId: form.coachId,
        ...range,
        capacity: Number(form.ptCapacity),
      });
      flash(`${Number(form.ptCapacity) > 1 ? "Đã tạo khung PT nhóm" : "Đã tạo khung PT 1:1"} ${form.when}`);
      setForm((f) => ({ ...f, when: "" }));
      setSheetOpen(false);
      load();
    } catch (err) {
      setSheetError(err.message); // hiện trong sheet — không để lỗi chìm sau Modal
    } finally {
      setBusy(false);
    }
  };

  const removeClass = async (id) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.delete(`/schedule/classes/${id}`);
      load();
    } catch (err) {
      flash(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  const removeSlot = async (id) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.delete(`/schedule/pt-slots/${id}`);
      load();
    } catch (err) {
      flash(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  // her-19: tạo lớp GROUP thì chỉ hiện HLV có chuyên môn của bộ môn đang chọn
  const coachesFor = (disciplineKey) =>
    trainers.filter((t) => !(t.specialties || []).length || t.specialties.includes(disciplineKey));

  // ---- her-21: dựng danh sách BUỔI trộn lớp + PT theo ngày ----

  // Đếm điểm danh theo buổi từ bookings đã tải (range theo tab)
  const summaryOf = {};
  for (const b of bookings) {
    const key = b.type === "group" ? `c-${b.classId}` : `s-${b.slotId}`;
    if (!summaryOf[key]) summaryOf[key] = { count: 0, done: 0, absent: 0 };
    summaryOf[key].count += 1;
    if (b.status === "completed") summaryOf[key].done += 1;
    if (b.status === "no_show") summaryOf[key].absent += 1;
  }

  let rows = [];
  {
    if (tab === "past") {
      // Lịch sử: dựng từ bookings (server sort mới nhất trước); buổi còn nằm trong cửa sổ
      // tải của classes/slots (00:00 hôm nay → +366 ngày) thì join lại item để vẫn Sửa/Xoá
      // — buổi trước hôm nay không join được, chỉ còn "Danh sách khách" (đúng chủ đích)
      const classById = Object.fromEntries(classes.map((x) => [String(x.id), x]));
      const slotById = Object.fromEntries(ptSlots.map((s) => [String(s.id), s]));
      // Đếm count/done/absent NGAY TRONG vòng gộp — join qua summaryOf sẽ dồn mọi booking
      // cũ thiếu classId/slotId vào chung 1 bucket "null", số khách sai (review her-21 V1);
      // booking cũ thiếu id thì gộp theo tên+giờ để không vỡ thành nhiều dòng (N7)
      const rowByKey = {};
      for (const b of bookings) {
        const key = b.type === "group"
          ? `c-${b.classId || `${b.title}|${b.startAt}`}`
          : `s-${b.slotId || `${b.title}|${b.startAt}`}`;
        if (!rowByKey[key]) {
          const item = b.type === "group" ? classById[String(b.classId)] : slotById[String(b.slotId)];
          rowByKey[key] = {
            id: key,
            kind: b.type === "group" ? "group" : "pt",
            classId: b.type === "group" ? b.classId : null,
            slotId: b.type === "pt" ? b.slotId : null,
            title: b.type === "group" ? `${b.title} · ${b.coach}` : b.title,
            startAt: b.startAt,
            item: item || null,
            hasCustomers: true,
            coach: b.coach,
            serviceType: b.serviceType, // her-22: server trả kèm để lọc theo bộ môn
            sum: { count: 0, done: 0, absent: 0 },
          };
          rows.push(rowByKey[key]);
        }
        rowByKey[key].sum.count += 1;
        if (b.status === "completed") rowByKey[key].sum.done += 1;
        if (b.status === "no_show") rowByKey[key].sum.absent += 1;
      }
    } else {
      // Hôm nay / Sắp tới: cấu trúc từ classes + slots — KHUNG TRỐNG vẫn hiện để sửa/xoá
      const now = new Date();
      const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
      const inRange = (d) => {
        const t = new Date(d);
        return tab === "today" ? t <= endOfToday : t >= now;
      };
      for (const x of classes) {
        if (!inRange(x.startAt)) continue;
        rows.push({
          id: `c-${x.id}`, kind: "group", classId: x.id, slotId: null,
          title: `${x.name} · ${x.coach}`, startAt: x.startAt, item: x,
          coach: x.coach, serviceType: x.serviceType,
          hasCustomers: x.customerNames.length > 0,
          booked: Math.max(x.capacity - x.spotsLeft, 0), capacity: x.capacity,
          sum: summaryOf[`c-${x.id}`],
        });
      }
      for (const s of ptSlots) {
        if (!inRange(s.startAt)) continue;
        rows.push({
          id: `s-${s.id}`, kind: "pt", classId: null, slotId: s.id,
          title: `${s.capacity > 1 ? "PT nhóm" : "PT 1:1"} — ${s.trainer}`, startAt: s.startAt, item: s,
          coach: s.trainer, serviceType: "pt",
          hasCustomers: s.bookedCount > 0,
          booked: s.bookedCount, capacity: s.capacity,
          sum: summaryOf[`s-${s.id}`],
        });
      }
      rows.sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
    }
  }
  // her-22: lọc theo chuỗi tìm — khớp tên lớp/tên HLV/bộ môn (cả key lẫn nhãn tiếng Việt),
  // không phân biệt hoa thường và DẤU ("duc" khớp "Đức")
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d");
  // Nhiều từ = mọi từ đều phải khớp ("yoga thu" ra buổi yoga của HLV Thu)
  const words = norm(search.trim()).split(/\s+/).filter(Boolean);
  if (words.length) {
    const labelOf = Object.fromEntries(disciplines);
    rows = rows.filter((r) => {
      const hay = [r.title, r.coach, r.serviceType, labelOf[r.serviceType]].map(norm).join(" ");
      return words.every((w) => hay.includes(w));
    });
  }

  const metaOf = (r) => {
    if (!r.hasCustomers) return "chưa có khách đặt";
    const parts = [];
    if (r.capacity != null) parts.push(`${r.booked}/${r.capacity} khách`);
    else if (r.sum) parts.push(`${r.sum.count} khách`);
    if (r.sum?.done) parts.push(`${r.sum.done} đến`);
    if (r.sum?.absent) parts.push(`${r.sum.absent} vắng`);
    return parts.join(" · ");
  };

  const sections = groupByDay(rows);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TopBar title="Lịch tập" />

      <View style={{ paddingHorizontal: 22 }}>
        <View style={[styles.searchBox, { backgroundColor: c.card, borderColor: c.line }]}>
          <Feather name="search" size={14} color={c.inkSoft} />
          {/* her-22: lọc BUỔI ngay khi gõ — theo bộ môn / tên HLV (khớp cả tên lớp) */}
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Tìm theo bộ môn hoặc tên HLV"
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
        contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 110 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(tab)} tintColor={c.primary} />}
        // her-26: lướt xuống cuối là tự tải trang lịch sử kế tiếp — không bắt bấm nút
        scrollEventThrottle={100}
        onScroll={({ nativeEvent: { layoutMeasurement, contentOffset, contentSize } }) => {
          // Danh sách ngắn hơn màn thì bounce/kéo-làm-mới cũng "chạm đáy" — bỏ qua,
          // ca đó đã có effect tự tải lo (review her-26 b1)
          if (contentSize.height <= layoutMeasurement.height || contentOffset.y <= 0) return;
          const nearBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 400;
          if (!nearBottom) { endReached.current = false; return; }
          if (endReached.current || loading || loadingMore || !canLoadMore) return;
          endReached.current = true;
          loadMore();
        }}
        onLayout={(e) => { viewH.current = e.nativeEvent.layout.height; }}
        onContentSizeChange={(w, h) => { contentH.current = h; }}
      >
        {sections.length === 0 && !loading && (
          <Text style={[styles.empty, { color: c.inkSoft }]}>
            {/* Đang lọc + lịch sử còn trang chưa tải → hệ thống đang tự tải tiếp (review her-22 #1) */}
            {words.length && hasMore && tab === "past" ? "Đang tìm trong lịch sử..." : "Không có buổi nào phù hợp."}
          </Text>
        )}

        {sections.map((sec) => (
          <View key={sec.key}>
            <SectionLabel>{sec.label}</SectionLabel>

            {/* Danh sách BUỔI: lớp + PT chung, đủ thao tác trên dòng */}
            {sec.items.map((r, i) => (
                <TimeRow
                  key={r.id}
                  time={fmtTime(r.startAt)}
                  title={r.title}
                  meta={metaOf(r)}
                  last={i === sec.items.length - 1}
                >
                  <View style={styles.actionRow}>
                    {r.hasCustomers && (r.classId || r.slotId) && (
                      <TouchableOpacity
                        onPress={() => { closeAllSheets(); setRoster(r.classId ? { classId: r.classId } : { slotId: r.slotId }); }}
                        hitSlop={8}
                      >
                        <Text style={[styles.deleteLink, { color: c.primary }]}>Danh sách khách</Text>
                      </TouchableOpacity>
                    )}
                    {/* item = còn trong cửa sổ tải (buổi trước hôm nay chỉ xem danh sách) */}
                    {!!r.item && (
                      <TouchableOpacity disabled={busy} onPress={() => openEdit(r.kind, r.item)} hitSlop={8}>
                        <Text style={[styles.deleteLink, { color: c.primary }]}>Sửa</Text>
                      </TouchableOpacity>
                    )}
                    {/* Chỉ khung chưa có khách mới xoá được (atomic ở server — C7) */}
                    {!!r.item && !r.hasCustomers && (
                      <TouchableOpacity disabled={busy} onPress={() => { closeAllSheets(); setConfirmDelete({ kind: r.kind, item: r.item }); }} hitSlop={8}>
                        <Text style={[styles.deleteLink, { color: c.inkSoft }]}>Xoá khung giờ</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </TimeRow>
              ))}
          </View>
        ))}

        {/* her-26: không còn nút Tải thêm — cuộn là tự tải, chỉ hiện vòng xoay khi đang tải */}
        {loadingMore && <ActivityIndicator style={{ marginTop: 16 }} color={c.primary} />}
      </ScrollView>

      {/* Nút nổi mở form — mẫu 10: pill trắng chữ terracotta, góc phải dưới */}
      <TouchableOpacity
        activeOpacity={0.85}
        style={[styles.fab, { backgroundColor: c.card }]}
        onPress={() => {
          closeAllSheets();
          setSheetError("");
          setSheetOpen(true);
        }}
      >
        <Text style={[styles.fabText, { color: c.primary }]}>+ Khung giờ mới</Text>
      </TouchableOpacity>

      <FormSheet
        visible={sheetOpen}
        title="Khung giờ mới"
        // Đang tạo thì không cho đóng — đóng giữa chừng là lỗi server hiện vào sheet
        // đã tắt, người dùng tưởng tạo thành công (review her-21 V2)
        onClose={() => { if (!busy) setSheetOpen(false); }}
      >
        {/* her-21: không còn tab con Lớp/PT — chọn LOẠI KHUNG ngay trong form */}
        <SectionLabel style={styles.sheetLabel}>Loại khung</SectionLabel>
        <View style={styles.chipWrap}>
          {[["group", "Lớp Group"], ["pt", "Khung PT"]].map(([key, label]) => (
            <TouchableOpacity
              key={key}
              onPress={() => setForm((f) => ({ ...f, kind: key }))}
              style={[
                styles.chip,
                { borderColor: c.line },
                form.kind === key && { backgroundColor: c.primaryTint, borderColor: c.primaryTint },
              ]}
            >
              <Text style={[styles.chipText, { color: form.kind === key ? c.primary : c.ink }]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* her-19: chọn BỘ MÔN TRƯỚC (lớp group) — danh sách HLV bên dưới lọc theo chuyên môn */}
        {form.kind === "group" && (
          <>
            <SectionLabel style={styles.sheetLabel}>Bộ môn</SectionLabel>
            <View style={styles.chipWrap}>
              {disciplines.map(([key, label]) => (
                <TouchableOpacity
                  key={key}
                  onPress={() => setForm((f) => {
                    // Đổi bộ môn: HLV đang chọn không thuộc môn mới thì bỏ chọn
                    const stillOk = coachesFor(key).some((t) => t.id === f.coachId);
                    return { ...f, discipline: key, coachId: stillOk ? f.coachId : "" };
                  })}
                  style={[
                    styles.chip,
                    { borderColor: c.line },
                    form.discipline === key && { backgroundColor: c.primaryTint, borderColor: c.primaryTint },
                  ]}
                >
                  <Text style={[styles.chipText, { color: form.discipline === key ? c.primary : c.ink }]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        <SectionLabel style={styles.sheetLabel}>
          {form.kind === "group" ? "HLV (có chuyên môn bộ môn này)" : "HLV"}
        </SectionLabel>
        <View style={styles.chipWrap}>
          {(form.kind === "group" ? coachesFor(form.discipline) : trainers).map((t) => (
            <TouchableOpacity
              key={t.id}
              onPress={() => setForm((f) => ({ ...f, coachId: t.id }))}
              style={[
                styles.chip,
                { borderColor: c.line },
                form.coachId === t.id && { backgroundColor: c.primary, borderColor: c.primary },
              ]}
            >
              <Text style={[styles.chipText, { color: form.coachId === t.id ? c.primaryOn : c.ink }]}>{t.name}</Text>
            </TouchableOpacity>
          ))}
          {form.kind === "group" && coachesFor(form.discipline).length === 0 && (
            <Text style={{ fontSize: 12, color: c.inkSoft }}>Chưa có HLV nào có chuyên môn này</Text>
          )}
        </View>

        <SectionLabel style={styles.sheetLabel}>Ngày giờ</SectionLabel>
        {/* Mục 11: bộ chọn lịch + giờ thay ô gõ tay — cần đủ bề ngang nên đứng riêng 1 hàng */}
        <DateTimeField value={form.when} onChange={(v) => setForm((f) => ({ ...f, when: v }))} />
        <View style={{ width: 150 }}>
          {form.kind === "group" ? (
            <>
              <SectionLabel style={styles.sheetLabel}>Sức chứa</SectionLabel>
              <TextInput
                value={form.capacity}
                onChangeText={(v) => setForm((f) => ({ ...f, capacity: v }))}
                keyboardType="number-pad"
                style={[styles.input, { borderBottomColor: c.line, color: c.ink }]}
              />
            </>
          ) : (
            <>
              {/* PT nhóm (mục 6): 1 = PT 1:1; tối đa 10 */}
              <SectionLabel style={styles.sheetLabel}>Số người tối đa</SectionLabel>
              <TextInput
                value={form.ptCapacity}
                onChangeText={(v) => setForm((f) => ({ ...f, ptCapacity: v }))}
                keyboardType="number-pad"
                style={[styles.input, { borderBottomColor: c.line, color: c.ink }]}
              />
            </>
          )}
        </View>

        {!!sheetError && <Text style={[styles.sheetError, { color: c.danger }]}>{sheetError}</Text>}
        <AppButton style={{ marginTop: 22 }} disabled={busy} onPress={form.kind === "group" ? createClass : createSlot}>
          {busy ? "Đang tạo..." : "Tạo khung giờ"}
        </AppButton>
      </FormSheet>

      <FormSheet
        visible={!!editTarget}
        title={editTarget?.kind === "pt" ? "Sửa khung PT" : "Sửa khung giờ Group"}
        onClose={() => { if (!busy) setEditTarget(null); }}
      >
        {!!editTarget && (() => {
          const isGroup = editTarget.kind === "group";
          const locked = isGroup ? editTarget.item.customerNames.length > 0 : editTarget.item.bookedCount > 0;
          return (
            <View>
              {/* her-20: Bộ môn TRƯỚC rồi mới HLV — khớp form tạo (góp ý 16/08); khung đã
                  có khách không đổi bộ môn được nên không hiện khối này */}
              {isGroup && !locked && (
                <>
                  <SectionLabel style={styles.sheetLabel}>Bộ môn</SectionLabel>
                  <View style={styles.chipWrap}>
                    {disciplines.map(([key, label]) => (
                      <TouchableOpacity
                        key={key}
                        onPress={() => setEditForm((f) => {
                          const stillOk = coachesFor(key).some((t) => String(t.id) === f.coachId);
                          return { ...f, discipline: key, coachId: stillOk ? f.coachId : "" };
                        })}
                        style={[
                          styles.chip,
                          { borderColor: c.line },
                          editForm.discipline === key && { backgroundColor: c.primaryTint, borderColor: c.primaryTint },
                        ]}
                      >
                        <Text style={[styles.chipText, { color: editForm.discipline === key ? c.primary : c.ink }]}>
                          {label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
              <SectionLabel style={styles.sheetLabel}>
                {isGroup && !locked ? "HLV (có chuyên môn bộ môn này)" : "HLV phụ trách"}
              </SectionLabel>
              <View style={styles.chipWrap}>
                {/* Lớp cũ chưa có bộ môn (serviceType rỗng) mà ĐÃ có khách: không lọc HLV
                    theo bộ môn đoán mò — hiện đủ để còn thấy/đổi đúng người (review N4) */}
                {(isGroup
                  ? (locked && !editTarget.item.serviceType ? trainers : coachesFor(editForm.discipline))
                  : trainers
                ).map((t) => (
                  <TouchableOpacity
                    key={t.id}
                    onPress={() => setEditForm((f) => ({ ...f, coachId: String(t.id) }))}
                    style={[
                      styles.chip,
                      { borderColor: c.line },
                      editForm.coachId === String(t.id) && { backgroundColor: c.primary, borderColor: c.primary },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: editForm.coachId === String(t.id) ? c.primaryOn : c.ink }]}>
                      {t.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {locked ? (
                <>
                  <Text style={[styles.lockNote, { color: c.inkSoft }]}>
                    {isGroup
                      ? "Khung này đã có khách đặt — chỉ đổi được HLV (quyết định 16/08). Muốn đổi giờ hãy hủy lịch cho khách (khách được hoàn buổi) rồi sửa."
                      : "Khung này đã có khách đặt — chỉ đổi được HLV hoặc NỚI số người tối đa. Muốn đổi giờ hãy hủy lịch cho khách (khách được hoàn buổi) rồi sửa."}
                  </Text>
                  {!isGroup && (
                    <View style={{ width: 140 }}>
                      <SectionLabel style={styles.sheetLabel}>Số người tối đa</SectionLabel>
                      <TextInput
                        value={editForm.capacity}
                        onChangeText={(v) => setEditForm((f) => ({ ...f, capacity: v }))}
                        keyboardType="number-pad"
                        style={[styles.input, { borderBottomColor: c.line, color: c.ink }]}
                      />
                    </View>
                  )}
                </>
              ) : (
                <>
                  <SectionLabel style={styles.sheetLabel}>Ngày giờ</SectionLabel>
                  <DateTimeField value={editForm.when} onChange={(v) => setEditForm((f) => ({ ...f, when: v }))} />
                  <View style={{ width: 150 }}>
                    <SectionLabel style={styles.sheetLabel}>{isGroup ? "Sức chứa" : "Số người tối đa"}</SectionLabel>
                    <TextInput
                      value={editForm.capacity}
                      onChangeText={(v) => setEditForm((f) => ({ ...f, capacity: v }))}
                      keyboardType="number-pad"
                      style={[styles.input, { borderBottomColor: c.line, color: c.ink }]}
                    />
                  </View>
                </>
              )}
              {!!editError && <Text style={[styles.sheetError, { color: c.danger }]}>{editError}</Text>}
              <AppButton style={{ marginTop: 22 }} disabled={busy} onPress={saveEdit}>
                {busy ? "Đang lưu..." : "Lưu thay đổi"}
              </AppButton>
            </View>
          );
        })()}
      </FormSheet>

      <ConfirmSheet
        visible={!!confirmDelete}
        busy={busy}
        title="Xoá khung giờ?"
        message={
          confirmDelete
            ? `Bạn chắc chắn muốn xoá khung ${fmtTime(confirmDelete.item.startAt)} ${dayLabel(confirmDelete.item.startAt)}? Thao tác không thể hoàn tác.`
            : ""
        }
        confirmLabel="Xoá khung giờ"
        onConfirm={async () => {
          if (!confirmDelete) return;
          if (confirmDelete.kind === "group") await removeClass(confirmDelete.item.id);
          else await removeSlot(confirmDelete.item.id);
          setConfirmDelete(null);
        }}
        onClose={() => setConfirmDelete(null)}
      />

      {/* her-20: quầy hủy được lịch khách ngay trong danh sách — hủy xong tải lại lịch */}
      <RosterSheet
        classId={roster?.classId}
        slotId={roster?.slotId}
        canClear
        canCancel
        onChanged={() => load()}
        onClose={() => setRoster(null)}
      />

      {!!toast && (
        <View style={[styles.toast, { backgroundColor: toast.isError ? c.danger : c.primary }]}>
          <Feather name={toast.isError ? "alert-circle" : "check"} size={14} color="#fff" />
          <Text style={styles.toastText}>{toast.msg}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: "row", gap: 20, borderBottomWidth: 1, marginTop: 14 },
  // her-22: ô tìm lọc buổi theo bộ môn / tên HLV
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
  tabBtn: { paddingBottom: 9 },
  tabLabel: { fontSize: 13, fontWeight: "700" },
  error: { fontSize: 12.5, marginHorizontal: 22, marginTop: 10, fontWeight: "700" },
  empty: { fontSize: 13, marginTop: 18 },
  deleteLink: { fontSize: 11.5, fontWeight: "700" },
  actionRow: { flexDirection: "row", gap: 16 },
  lockNote: { fontSize: 12, lineHeight: 18, marginTop: 12 },
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
  sheetLabel: { marginTop: 12 },
  sheetError: { fontSize: 12.5, fontWeight: "700", marginTop: 14 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5 },
  chipText: { fontSize: 12.5, fontWeight: "700" },
  // Ô nhập kiểu gạch chân theo bản thiết kế
  input: { borderBottomWidth: 1.5, paddingVertical: 8, fontSize: 15, marginTop: 2 },
  toast: {
    position: "absolute",
    bottom: 80,
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
});
