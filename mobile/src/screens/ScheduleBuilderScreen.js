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
import { FORMATS, FORMAT_18_SERVICE, disciplinesFor, coachesFor } from "../utils/formats";
import { classTitle } from "../utils/displayName";
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
// mọi buổi chung 1 danh sách theo ngày (chốt 16/08)
// her-25: "Tất cả" (trộn lịch sử + tương lai, dùng lâu không cuộn nổi) đổi thành "Lịch sử" —
// CHỈ buổi đã qua, ngày gần nhất lên đầu rồi lùi dần (chốt 16/08)
const TABS = [
  ["today", "Hôm nay"],
  ["upcoming", "Sắp tới"],
  ["past", "Lịch sử"],
];
// her-40 (20/08): "buổi ĐÃ CÓ KHÁCH" phải tính theo SỐ CHỖ ĐÃ GIỮ, không theo customerNames.
// customerNames chỉ gồm khách còn trạng thái "booked": buổi qua giờ bị hệ thống tự chuyển
// "đã tập" (sweep) sẽ trả rỗng dù ghế vẫn giữ → dòng hiện "chưa có khách đặt" và chìa nút
// Sửa/Xoá (server vẫn chặn 400 nhưng UI nói sai — lỗi chủ dự án bắt 20/08).
// Server khoá sửa/xoá theo bookedCount = capacity - spotsLeft, app dùng ĐÚNG con số đó.
function bookedOf(x) {
  const seats = Math.max((x?.capacity ?? 0) - (x?.spotsLeft ?? 0), 0);
  return Math.max(seats, x?.customerNames?.length || 0);
}
// her-19: danh mục bộ môn lấy từ server (DB) — thêm môn mới không phải sửa app.
// Bản thiết kế bỏ ô thời lượng — mọi buổi mặc định 60 phút
const DEFAULT_DURATION_MINUTES = 60;

export default function ScheduleBuilderScreen() {
  const { c } = useTheme();
  const [tab, setTab] = useState("today");
  const [trainers, setTrainers] = useState([]);
  const [disciplines, setDisciplines] = useState([]); // [[key, label]] từ /disciplines
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  // toast: { msg, isError } — lỗi hiện icon/màu riêng, không giống thông báo thành công
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false); // chặn bấm đúp tạo/xoá buổi

  // Form tạo buổi nằm trong bottom sheet — bấm nút nổi "+" để mở
  const [sheetOpen, setSheetOpen] = useState(false);
  // Sheet SỬA buổi (mục 4): item của lớp — lớp có khách chỉ đổi được HLV (16/08)
  const [editTarget, setEditTarget] = useState(null);
  // her-36: name = tên riêng của buổi (tuỳ chọn, bỏ trống thì server lấy tên bộ môn)
  const [editForm, setEditForm] = useState({ format: "1:4", discipline: "", coachId: "", name: "", when: "" });
  const [editError, setEditError] = useState("");
  // Sheet danh sách khách của 1 buổi: { classId }
  const [roster, setRoster] = useState(null);
  // her-17: xoá buổi phải qua hộp xác nhận — item của lớp | null
  const [confirmDelete, setConfirmDelete] = useState(null);
  // Lỗi lúc tạo hiện NGAY TRONG sheet — toast ngoài màn bị Modal che mất (L8)
  const [sheetError, setSheetError] = useState("");
  // her-35: thứ tự form = loại hình → bộ môn → HLV → ngày giờ (chốt 19/08)
  const [form, setForm] = useState({ format: "1:4", discipline: "", coachId: "", name: "", when: "" });

  // her-21: booking để đếm điểm danh + lịch sử (tab Lịch sử) — kèm token chống response
  // về muộn (review her-20 V2)
  const [bookings, setBookings] = useState([]);
  // her-39: tab Lịch sử còn nguồn thứ 2 — LỚP QUÁ KHỨ CHƯA CÓ KHÁCH (quầy vừa dựng lại buổi
  // đã tập). Dựng từ bookings thôi thì buổi trống vô hình, không có đường vào để add khách.
  const [pastClasses, setPastClasses] = useState([]);
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
      // Trang sau chỉ cần thêm booking — không tải lại HLV/lớp/danh mục (cuộn lịch sử
      // dài mà mỗi trang kéo cả 4 API thì nặng vô ích — review her-26 b4)
      if (p > 1) {
        const more = await api.get("/management/bookings", { range: t, page: p, limit: t === "past" ? 20 : 100 });
        // her-39: cuộn sâu vào lịch sử thì nới luôn cửa sổ lớp quá khứ theo trang (30 ngày/trang)
        if (t === "past") {
          const olds = await api.get("/schedule/classes", {
            from: new Date(Date.now() - p * 30 * 24 * 3600 * 1000).toISOString(),
            to: new Date().toISOString(),
          });
          if (seq !== loadSeq.current) return;
          setPastClasses(olds.classes);
        }
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
      // her-39: tab Lịch sử tải thêm lớp ĐÃ QUA (30 ngày gần nhất) để buổi trống vẫn hiện
      const pastFrom = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const [trainersRes, classesRes, discRes, bookingsRes, pastRes] = await Promise.all([
        api.get("/schedule/trainers"),
        api.get("/schedule/classes", { from: from.toISOString(), to }),
        api.get("/disciplines"),
        // Điểm danh + lịch sử — range theo tab đang xem. Lịch sử tải TỪNG TRANG NHỎ (20)
        // cho nhẹ, cuộn cuối tự tải tiếp (her-26); tab khác giữ 100 vì booking còn dùng
        // để đếm tóm tắt đến/vắng
        api.get("/management/bookings", { range: t, page: p, limit: t === "past" ? 20 : 100 }),
        t === "past"
          ? api.get("/schedule/classes", { from: pastFrom, to: new Date().toISOString() })
          : Promise.resolve({ classes: [] }),
      ]);
      if (seq !== loadSeq.current) return; // đã có lần tải mới hơn (review her-20 V2)
      setPastClasses(pastRes.classes);
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
      setClasses(classesRes.classes);
      setForm((f) => {
        // review her-19 V5: bộ môn mặc định phải nằm trong danh mục thật (và hợp loại hình
        // đang chọn — 1:8 chỉ Yoga); V6: HLV preselect phải QUA LỌC chuyên môn bộ môn đó
        const allowed = disciplinesFor(discList, f.format);
        const discipline = allowed.some(([k]) => k === f.discipline) ? f.discipline : allowed[0]?.[0] || "";
        const pool = coachesFor(trainersRes.trainers, discipline);
        return {
          ...f,
          discipline,
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
      const prevCount = classes.length;
      while (windowRef.current < maxDays) {
        windowRef.current = Math.min(windowRef.current + 30, maxDays);
        const to = new Date(Date.now() + windowRef.current * 24 * 3600 * 1000).toISOString();
        const cr = await api.get("/schedule/classes", { from: from.toISOString(), to });
        if (seq !== loadSeq.current) return;
        setClasses(cr.classes);
        if (cr.classes.length > prevCount) break; // có buổi mới — dừng, hiện ra
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
    setPastClasses([]); // nguồn lớp quá khứ chỉ dùng cho tab Lịch sử (her-39)
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

  const openEdit = (item) => {
    closeAllSheets();
    setEditForm({
      format: item.format || "1:4",
      discipline: item.serviceType || "",
      coachId: String(item.coachId),
      name: item.name || "", // her-36: điền sẵn tên hiện tại để sửa
      when: fmtWhen(item.startAt),
    });
    setEditError("");
    setEditTarget(item);
  };

  const saveEdit = async () => {
    if (busy || !editTarget) return;
    const item = editTarget;
    const locked = bookedOf(item) > 0; // her-40: khớp luật server (bookedCount > 0)
    if (!editForm.coachId) return setEditError("Chọn HLV phụ trách");

    let body;
    if (locked) {
      // Lớp đã có khách: CHỈ đổi HLV (quyết định 16/08) — giờ/bộ môn/loại hình server chặn
      body = { coachId: editForm.coachId };
    } else {
      if (!editForm.discipline) return setEditError("Chọn bộ môn");
      if (!editForm.when) return setEditError("Chưa chọn ngày giờ — bấm ô \"Chọn ngày giờ\"");
      const parsed = parseQuickDateTime(editForm.when);
      if (parsed.error) return setEditError(parsed.error);
      // Giữ nguyên thời lượng cũ của buổi khi dời giờ
      const duration = new Date(item.endAt) - new Date(item.startAt);
      const startAt = parsed.date.toISOString();
      const endAt = new Date(parsed.date.getTime() + duration).toISOString();
      body = { coachId: editForm.coachId, startAt, endAt };
      if (editForm.format !== item.format) body.format = editForm.format;
      if (editForm.discipline !== item.serviceType) body.serviceType = editForm.discipline;
      // her-36: chỉ gửi tên khi NGƯỜI DÙNG thật sự đổi ô tên — dời giờ lớp có tên riêng
      // không bị âm thầm đổi tên (review her-09 #6). Xoá trống ô tên = gửi chuỗi rỗng,
      // server đặt lại theo nhãn bộ môn.
      const typedName = (editForm.name || "").trim();
      if (typedName !== (item.name || "")) body.name = typedName;
    }
    setEditError("");
    setBusy(true);
    try {
      await api.patch(`/schedule/classes/${item.id}`, body);
      flash("Đã cập nhật buổi tập");
      setEditTarget(null);
      load();
    } catch (err) {
      setEditError(err.message); // hiện trong sheet — không để lỗi chìm sau Modal (L8)
    } finally {
      setBusy(false);
    }
  };

  // Kiểm tra form tạo buổi: loại hình + bộ môn + HLV + ngày giờ (không nhận ngày quá khứ)
  const validateForm = () => {
    if (!form.format) {
      setSheetError("Chọn loại hình trước");
      return null;
    }
    if (!form.discipline) {
      setSheetError("Chọn bộ môn trước");
      return null;
    }
    if (!form.coachId) {
      setSheetError("Chọn HLV phụ trách trước");
      return null;
    }
    if (!form.when) {
      setSheetError("Chưa chọn ngày giờ — bấm ô \"Chọn ngày giờ\" để chọn trên lịch");
      return null;
    }
    // her-39: quầy được chọn ngày QUÁ KHỨ (dựng lại buổi khách đã tập) — server cũng chỉ
    // mở đường này cho lễ tân/admin
    const parsed = parseQuickDateTime(form.when, new Date(), { allowPast: true });
    if (parsed.error) {
      setSheetError(parsed.error);
      return null;
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
      // her-36: tên riêng là tuỳ chọn — bỏ trống thì KHÔNG gửi, server lấy nhãn bộ môn
      const typedName = form.name.trim();
      const created = await api.post("/schedule/classes", {
        ...(typedName ? { name: typedName } : {}),
        format: form.format, // sức chứa do server gán theo loại hình (her-35)
        serviceType: form.discipline,
        coachId: form.coachId,
        ...range,
      });
      // Ghi rõ ngày — buổi xa hơn cửa sổ đang xem chưa hiện ngay, kẻo tưởng tạo hụt (her-28)
      flash(`Đã tạo buổi ${typedName || label} · ${form.format} ${form.when}`);
      setForm((f) => ({ ...f, when: "", name: "" }));
      setSheetOpen(false);
      // her-39: buổi trong QUÁ KHỨ = buổi khách đã tập xong -> mở luôn danh sách khách để
      // add người đã tập, khỏi phải đi tìm lại buổi vừa tạo
      const createdId = created?.class?._id || created?.class?.id;
      if (createdId && new Date(range.startAt) < new Date()) {
        setRoster({ classId: String(createdId) });
      }
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

  // her-19/her-35: HLV lọc theo chuyên môn, bộ môn lọc theo loại hình — utils/formats.js
  const coaches = (disciplineKey) => coachesFor(trainers, disciplineKey);
  const disciplineChips = (format) => disciplinesFor(disciplines, format);
  const labelFor = (key) => disciplines.find(([k]) => k === key)?.[1] || key;
  // her-36: ô tên đang để nguyên nhãn bộ môn CŨ (tức tên tự sinh) thì đổi theo bộ môn mới;
  // tên riêng do người dùng gõ thì giữ nguyên
  const nameForDiscipline = (currentName, oldKey, newKey) =>
    (currentName || "").trim() === labelFor(oldKey) ? labelFor(newKey) : currentName;
  // Chọn 1:8 thì tự sang Yoga — nhưng chỉ khi danh mục THẬT SỰ có Yoga (khớp fallback của load)
  const disciplineForFormat = (format, current) => {
    if (format !== "1:8") return current;
    return disciplines.some(([k]) => k === FORMAT_18_SERVICE) ? FORMAT_18_SERVICE : "";
  };

  // ---- her-21: dựng danh sách BUỔI theo ngày ----

  // Đếm điểm danh theo buổi từ bookings đã tải (range theo tab)
  // her-40 (20/08): "đến" CHỈ tính booking có dấu điểm danh thật (attendanceAt). Buổi qua giờ
  // được hệ thống tự chuyển "đã tập" (sweep) mang status completed nhưng chưa ai điểm danh →
  // đếm vào "chưa điểm danh" để quầy biết còn phải điểm danh bù (không tính hoa hồng — her-10).
  const countBooking = (s, b) => {
    s.count += 1;
    if (b.status === "completed") {
      if (b.attendanceAt) s.done += 1;
      else s.pending += 1;
    }
    if (b.status === "no_show") s.absent += 1; // "vắng" luôn do người bấm
  };
  const summaryOf = {};
  for (const b of bookings) {
    const key = `c-${b.classId}`;
    if (!summaryOf[key]) summaryOf[key] = { count: 0, done: 0, absent: 0, pending: 0 };
    countBooking(summaryOf[key], b);
  }

  let rows = [];
  {
    if (tab === "past") {
      // Lịch sử: dựng từ bookings (server sort mới nhất trước); buổi còn nằm trong cửa sổ
      // tải của classes (00:00 hôm nay → +366 ngày) thì join lại item để vẫn Sửa/Xoá
      // — buổi trước hôm nay không join được, chỉ còn "Danh sách khách" (đúng chủ đích)
      const classById = Object.fromEntries(classes.map((x) => [String(x.id), x]));
      // Đếm count/done/absent NGAY TRONG vòng gộp — join qua summaryOf sẽ dồn mọi booking
      // cũ thiếu classId vào chung 1 bucket "null", số khách sai (review her-21 V1);
      // booking cũ thiếu id thì gộp theo tên+giờ để không vỡ thành nhiều dòng (N7)
      const rowByKey = {};
      for (const b of bookings) {
        const key = `c-${b.classId || `${b.title}|${b.startAt}`}`;
        if (!rowByKey[key]) {
          const item = classById[String(b.classId)];
          rowByKey[key] = {
            id: key,
            classId: b.classId || null,
            title: classTitle({ name: b.title, format: b.format, coach: b.coach }),
            startAt: b.startAt,
            item: item || null,
            hasCustomers: true,
            ended: true, // tab Lịch sử: mọi buổi đã kết thúc (her-40: để hiện "chưa điểm danh")
            coach: b.coach,
            serviceType: b.serviceType, // her-22: server trả kèm để lọc theo bộ môn
            sum: { count: 0, done: 0, absent: 0, pending: 0 },
          };
          rows.push(rowByKey[key]);
        }
        countBooking(rowByKey[key].sum, b);
      }
      // her-39: buổi ĐÃ QUA nhưng CHƯA CÓ KHÁCH (quầy vừa dựng lại buổi đã tập) — bookings
      // không có dòng nào nên phải lấy từ danh sách lớp. Không gắn `item` (lớp đã kết thúc
      // không sửa được), chỉ để mở "Danh sách khách" mà add học viên vào.
      const nowMs = Date.now();
      for (const x of pastClasses) {
        if (rowByKey[`c-${x.id}`]) continue;
        if (new Date(x.endAt).getTime() >= nowMs) continue; // buổi đang diễn ra thuộc "Hôm nay"
        // Chỉ lấy buổi THẬT SỰ 0 khách. Dùng chỗ đã đặt chứ không dùng customerNames:
        // customerNames chỉ gồm khách còn "booked", buổi cũ đã điểm danh xong sẽ rỗng —
        // lấy nhầm sẽ hiện "chưa có khách đặt" cho buổi vốn có người tập
        if (x.spotsLeft < x.capacity) continue;
        rows.push({
          id: `c-${x.id}`, classId: x.id,
          title: classTitle(x), startAt: x.startAt, item: null,
          hasCustomers: false, coach: x.coach, serviceType: x.serviceType,
        });
      }
      rows.sort((a, b) => new Date(b.startAt) - new Date(a.startAt)); // lịch sử: mới nhất trước
    } else {
      // Hôm nay / Sắp tới: dựng từ classes — buổi TRỐNG vẫn hiện để sửa/xoá
      const now = new Date();
      const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
      const inRange = (d) => {
        const t = new Date(d);
        return tab === "today" ? t <= endOfToday : t >= now;
      };
      for (const x of classes) {
        if (!inRange(x.startAt)) continue;
        rows.push({
          id: `c-${x.id}`, classId: x.id,
          title: classTitle(x), startAt: x.startAt, item: x,
          coach: x.coach, serviceType: x.serviceType,
          hasCustomers: bookedOf(x) > 0, // her-40: theo chỗ đã giữ, không theo customerNames
          booked: bookedOf(x), capacity: x.capacity,
          // her-40: buổi ĐÃ KẾT THÚC thì server chặn mọi sửa ("lịch sử giữ nguyên") —
          // ẩn nút Sửa thay vì để bấm vào rồi báo lỗi
          ended: new Date(x.endAt) < new Date(),
          sum: summaryOf[`c-${x.id}`],
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

  // her-38: dòng đậm đã có "Tên · loại hình · HLV" → dòng phụ CHỈ còn tình trạng khách
  const metaOf = (r) => {
    const parts = [];
    if (!r.hasCustomers) return "chưa có khách đặt";
    if (r.capacity != null) parts.push(`${r.booked}/${r.capacity} khách`);
    else if (r.sum) parts.push(`${r.sum.count} khách`);
    if (r.sum?.done) parts.push(`${r.sum.done} đến`);
    if (r.sum?.absent) parts.push(`${r.sum.absent} vắng`);
    // her-40: buổi ĐÃ KẾT THÚC còn khách chưa điểm danh — nhắc quầy điểm danh bù
    if (r.ended && r.sum?.pending) parts.push(`${r.sum.pending} chưa điểm danh`);
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
        contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 110 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(tab)} tintColor={c.accent} />}
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

            {/* Danh sách BUỔI: đủ thao tác trên dòng */}
            {sec.items.map((r, i) => (
                <TimeRow
                  key={r.id}
                  time={fmtTime(r.startAt)}
                  title={r.title}
                  meta={metaOf(r)}
                  last={i === sec.items.length - 1}
                >
                  <View style={styles.actionRow}>
                    {/* her-39: hiện cả khi buổi chưa có khách — đây là đường quầy ĐẶT HỘ
                        (thêm học viên vào buổi) */}
                    {!!r.classId && (
                      <TouchableOpacity
                        onPress={() => { closeAllSheets(); setRoster({ classId: r.classId }); }}
                        hitSlop={8}
                      >
                        <Text style={[styles.deleteLink, { color: c.accent }]}>Danh sách khách</Text>
                      </TouchableOpacity>
                    )}
                    {/* item = còn trong cửa sổ tải (buổi trước hôm nay chỉ xem danh sách) */}
                    {!!r.item && !r.ended && (
                      <TouchableOpacity disabled={busy} onPress={() => openEdit(r.item)} hitSlop={8}>
                        <Text style={[styles.deleteLink, { color: c.accent }]}>Sửa</Text>
                      </TouchableOpacity>
                    )}
                    {/* Chỉ buổi chưa có khách mới xoá được (atomic ở server — C7) */}
                    {!!r.item && !r.hasCustomers && (
                      <TouchableOpacity disabled={busy} onPress={() => { closeAllSheets(); setConfirmDelete(r.item); }} hitSlop={8}>
                        <Text style={[styles.deleteLink, { color: c.inkSoft }]}>Xoá buổi</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </TimeRow>
              ))}
          </View>
        ))}

        {/* her-26: không còn nút Tải thêm — cuộn là tự tải, chỉ hiện vòng xoay khi đang tải */}
        {loadingMore && <ActivityIndicator style={{ marginTop: 16 }} color={c.accent} />}
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
        <Feather name="plus" size={24} color={c.accent} />
      </TouchableOpacity>

      <FormSheet
        visible={sheetOpen}
        title="Buổi tập mới"
        // Đang tạo thì không cho đóng — đóng giữa chừng là lỗi server hiện vào sheet
        // đã tắt, người dùng tưởng tạo thành công (review her-21 V2)
        onClose={() => { if (!busy) setSheetOpen(false); }}
      >
        {/* her-35: loại hình → bộ môn → HLV → ngày giờ (chốt 19/08) */}
        <SectionLabel style={styles.sheetLabel}>Loại hình</SectionLabel>
        <View style={styles.chipWrap}>
          {FORMATS.map((key) => (
            <TouchableOpacity
              key={key}
              onPress={() => setForm((f) => {
                // 1:8 chỉ Yoga — chọn luôn giúp; HLV đang chọn còn hợp bộ môn thì GIỮ
                const discipline = disciplineForFormat(key, f.discipline);
                const stillOk = coaches(discipline).some((t) => t.id === f.coachId);
                return { ...f, format: key, discipline, coachId: stillOk ? f.coachId : "" };
              })}
              style={[
                styles.chip,
                { borderColor: c.line },
                form.format === key && { backgroundColor: c.primaryTint, borderColor: c.primaryTint },
              ]}
            >
              <Text style={[styles.chipText, { color: form.format === key ? c.accent : c.ink }]}>{key}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* her-19: chọn BỘ MÔN TRƯỚC — danh sách HLV bên dưới lọc theo chuyên môn */}
        <SectionLabel style={styles.sheetLabel}>Bộ môn</SectionLabel>
        <View style={styles.chipWrap}>
          {disciplineChips(form.format).map(([key, label]) => (
            <TouchableOpacity
              key={key}
              onPress={() => setForm((f) => {
                // Đổi bộ môn: HLV đang chọn không thuộc môn mới thì bỏ chọn
                const stillOk = coaches(key).some((t) => t.id === f.coachId);
                return { ...f, discipline: key, coachId: stillOk ? f.coachId : "" };
              })}
              style={[
                styles.chip,
                { borderColor: c.line },
                form.discipline === key && { backgroundColor: c.primaryTint, borderColor: c.primaryTint },
              ]}
            >
              <Text style={[styles.chipText, { color: form.discipline === key ? c.accent : c.ink }]}>{label}</Text>
            </TouchableOpacity>
          ))}
          {disciplineChips(form.format).length === 0 && (
            <Text style={{ fontSize: 12, color: c.inkSoft }}>Chưa có bộ môn — kiểm tra kết nối</Text>
          )}
        </View>

        {/* her-36: mỗi buổi có thể mang tên riêng — bỏ trống thì server lấy tên bộ môn */}
        <SectionLabel style={styles.sheetLabel}>Tên lớp</SectionLabel>
        <TextInput
          value={form.name}
          onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
          placeholder="Bỏ trống = tên bộ môn"
          placeholderTextColor={c.inkSoft}
          maxLength={100}
          style={[styles.input, { borderBottomColor: c.line, color: c.ink }]}
        />

        <SectionLabel style={styles.sheetLabel}>HLV (có chuyên môn bộ môn này)</SectionLabel>
        <View style={styles.chipWrap}>
          {coaches(form.discipline).map((t) => (
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
          {coaches(form.discipline).length === 0 && (
            <Text style={{ fontSize: 12, color: c.inkSoft }}>Chưa có HLV nào có chuyên môn này</Text>
          )}
        </View>

        <SectionLabel style={styles.sheetLabel}>Ngày giờ</SectionLabel>
        {/* Mục 11: bộ chọn lịch + giờ thay ô gõ tay — cần đủ bề ngang nên đứng riêng 1 hàng.
            her-39: quầy chọn được cả ngày ĐÃ QUA (dựng lại buổi khách đã tập) */}
        <DateTimeField allowPast value={form.when} onChange={(v) => setForm((f) => ({ ...f, when: v }))} />

        {!!sheetError && <Text style={[styles.sheetError, { color: c.danger }]}>{sheetError}</Text>}
        <AppButton style={{ marginTop: 22 }} disabled={busy} onPress={createClass}>
          {busy ? "Đang tạo..." : "Tạo buổi tập"}
        </AppButton>
      </FormSheet>

      <FormSheet
        visible={!!editTarget}
        title="Sửa buổi tập"
        onClose={() => { if (!busy) setEditTarget(null); }}
      >
        {!!editTarget && (() => {
          const locked = bookedOf(editTarget) > 0; // her-40: khớp luật server (bookedCount > 0)
          return (
            <View>
              {/* her-35: cùng thứ tự form tạo — loại hình → bộ môn → HLV → ngày giờ.
                  Lớp đã có khách chỉ đổi được HLV nên 3 khối kia ẩn đi (server chặn) */}
              {!locked && (
                <>
                  <SectionLabel style={styles.sheetLabel}>Loại hình</SectionLabel>
                  <View style={styles.chipWrap}>
                    {FORMATS.map((key) => (
                      <TouchableOpacity
                        key={key}
                        onPress={() => setEditForm((f) => {
                          const discipline = disciplineForFormat(key, f.discipline);
                          const stillOk = coaches(discipline).some((t) => String(t.id) === f.coachId);
                          return {
                            ...f,
                            format: key,
                            discipline,
                            name: nameForDiscipline(f.name, f.discipline, discipline),
                            coachId: stillOk ? f.coachId : "",
                          };
                        })}
                        style={[
                          styles.chip,
                          { borderColor: c.line },
                          editForm.format === key && { backgroundColor: c.primaryTint, borderColor: c.primaryTint },
                        ]}
                      >
                        <Text style={[styles.chipText, { color: editForm.format === key ? c.accent : c.ink }]}>
                          {key}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <SectionLabel style={styles.sheetLabel}>Bộ môn</SectionLabel>
                  <View style={styles.chipWrap}>
                    {disciplineChips(editForm.format).map(([key, label]) => (
                      <TouchableOpacity
                        key={key}
                        onPress={() => setEditForm((f) => {
                          const stillOk = coaches(key).some((t) => String(t.id) === f.coachId);
                          return {
                            ...f,
                            discipline: key,
                            name: nameForDiscipline(f.name, f.discipline, key),
                            coachId: stillOk ? f.coachId : "",
                          };
                        })}
                        style={[
                          styles.chip,
                          { borderColor: c.line },
                          editForm.discipline === key && { backgroundColor: c.primaryTint, borderColor: c.primaryTint },
                        ]}
                      >
                        <Text style={[styles.chipText, { color: editForm.discipline === key ? c.accent : c.ink }]}>
                          {label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* her-36: đổi tên buổi — chỉ khi lớp chưa có khách (server chặn, L7) */}
                  <SectionLabel style={styles.sheetLabel}>Tên lớp</SectionLabel>
                  <TextInput
                    value={editForm.name}
                    onChangeText={(v) => setEditForm((f) => ({ ...f, name: v }))}
                    placeholder="Bỏ trống = tên bộ môn"
                    placeholderTextColor={c.inkSoft}
                    maxLength={100}
                    style={[styles.input, { borderBottomColor: c.line, color: c.ink }]}
                  />
                </>
              )}
              <SectionLabel style={styles.sheetLabel}>
                {locked ? "HLV phụ trách" : "HLV (có chuyên môn bộ môn này)"}
              </SectionLabel>
              <View style={styles.chipWrap}>
                {/* Lớp cũ chưa có bộ môn (serviceType rỗng) mà ĐÃ có khách: không lọc HLV
                    theo bộ môn đoán mò — hiện đủ để còn thấy/đổi đúng người (review N4) */}
                {(locked && !editTarget.serviceType ? trainers : coaches(editForm.discipline)).map((t) => (
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
                <Text style={[styles.lockNote, { color: c.inkSoft }]}>
                  Lớp đã có khách — chỉ đổi được HLV. Muốn đổi giờ hãy hủy lịch cho khách
                  (khách được hoàn buổi) rồi sửa.
                </Text>
              ) : (
                <>
                  <SectionLabel style={styles.sheetLabel}>Ngày giờ</SectionLabel>
                  <DateTimeField value={editForm.when} onChange={(v) => setEditForm((f) => ({ ...f, when: v }))} />
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
        title="Xoá buổi tập?"
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

      {/* her-20: quầy hủy được lịch khách ngay trong danh sách — hủy xong tải lại lịch */}
      <RosterSheet
        classId={roster?.classId}
        canClear
        canCancel
        canAdd
        onChanged={() => load()}
        onClose={() => setRoster(null)}
      />

      {!!toast && (
        <View style={[styles.toast, { backgroundColor: toast.isError ? c.danger : c.accent }]}>
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
  sheetLabel: { marginTop: 12 },
  // Ô nhập gạch chân — cùng kiểu với các form khác của app (her-36)
  input: { borderBottomWidth: 1.5, paddingVertical: 8, fontSize: 15, marginTop: 2 },
  sheetError: { fontSize: 12.5, fontWeight: "700", marginTop: 14 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5 },
  chipText: { fontSize: 12.5, fontWeight: "700" },
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
