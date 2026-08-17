import { useRef, useLayoutEffect } from "react";
import { Platform, TextInput } from "react-native";

// her-19: ô nhập TIỀN — hiển thị dạng 000.000.000 (dấu chấm ngăn nghìn) và GIỮ ĐÚNG VỊ TRÍ
// CON TRỎ khi gõ/xoá/dán ở bất kỳ chỗ nào giữa chuỗi (góp ý 16/08).
//
// Cách làm (không dùng prop `selection` — prop này hay giật con trỏ trên cả web lẫn native):
// 1. Suy vị trí con trỏ SAU thao tác từ CHÍNH nội dung: so chuỗi cũ/mới lấy phần đầu + phần
//    đuôi chung → điểm thay đổi kết thúc ở `text.length - đuôi_chung` = nơi con trỏ đang đứng.
// 2. Đếm số CHỮ SỐ bên trái điểm đó, format lại, rồi đặt con trỏ ngay sau chữ số thứ N của
//    chuỗi đã format — thêm/bớt dấu chấm không làm con trỏ trôi.
// 3. Áp con trỏ TRỰC TIẾP sau khi render: web = dom.setSelectionRange; native = setNativeProps.
// props: value (chuỗi số thô, vd "5000000"), onChangeValue(rawDigits), + mọi props TextInput.

const groupDots = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

export default function MoneyInput({ value, onChangeValue, style, ...rest }) {
  const display = value ? groupDots(String(value)) : "";
  const inputRef = useRef(null);
  const pendingCaret = useRef(null);
  const prevRef = useRef(display);
  prevRef.current = display; // luôn là chuỗi ĐANG hiển thị trước lần gõ kế tiếp

  useLayoutEffect(() => {
    if (pendingCaret.current == null) return;
    const pos = pendingCaret.current;
    pendingCaret.current = null;
    const node = inputRef.current;
    if (!node) return;
    try {
      if (Platform.OS === "web" && typeof node.setSelectionRange === "function") {
        node.setSelectionRange(pos, pos);
      } else if (typeof node.setNativeProps === "function") {
        node.setNativeProps({ selection: { start: pos, end: pos } });
        // trả quyền cho hệ thống ở tick sau để user vẫn tự di chuyển con trỏ được
        setTimeout(() => node.setNativeProps?.({ selection: null }), 0);
      }
    } catch {
      // đặt con trỏ là "tiện", không được làm vỡ nhập liệu
    }
  }, [display]);

  const handleChange = (text) => {
    const prev = prevRef.current;
    // Vị trí con trỏ SAU thao tác. Trên web đọc THẲNG từ DOM (sự kiện input bắn khi
    // trình duyệt đã đặt con trỏ xong) — so-chuỗi không phân biệt được xoá/chèn ở đâu
    // khi các chữ số LẶP nhau (vd 112233112233: xoá số 1 đầu hay số 1 thứ hai cho ra
    // cùng một chuỗi, diff luôn đoán vị trí CUỐI của dãy lặp → con trỏ nhảy — góp ý 16/08).
    let caretInNewText = null;
    const domNode = inputRef.current;
    // selectionEnd thay vì selectionStart: kéo-thả/dán có thể để phần vừa chèn đang được
    // CHỌN — con trỏ logic là CUỐI phần chèn; caret thường thì 2 giá trị bằng nhau (review N1)
    if (Platform.OS === "web" && domNode && typeof domNode.selectionEnd === "number") {
      caretInNewText = domNode.selectionEnd;
    }
    if (caretInNewText == null || caretInNewText < 0 || caretInNewText > text.length) {
      // Native (chưa đọc được con trỏ thật): suy từ phần đầu + phần đuôi chung — đúng cho
      // mọi ca trừ dãy số lặp; sẽ kiểm tay trên Expo Go (testcase V3)
      let p = 0;
      while (p < prev.length && p < text.length && prev[p] === text[p]) p += 1;
      let sfx = 0;
      while (
        sfx < prev.length - p &&
        sfx < text.length - p &&
        prev[prev.length - 1 - sfx] === text[text.length - 1 - sfx]
      ) sfx += 1;
      caretInNewText = text.length - sfx; // con trỏ đứng ngay sau phần vừa thay đổi
    }

    const digitsLeft = (text.slice(0, caretInNewText).match(/\d/g) || []).length;
    const rawDigits = (text.match(/\d/g) || []).join("").replace(/^0+(?=\d)/, ""); // bỏ 0 thừa đầu
    const formatted = rawDigits ? groupDots(rawDigits) : "";

    // Con trỏ mới = sau chữ số thứ digitsLeft trong chuỗi đã format
    let pos = 0;
    let seen = 0;
    while (pos < formatted.length && seen < digitsLeft) {
      if (/\d/.test(formatted[pos])) seen += 1;
      pos += 1;
    }
    if (formatted === prev) {
      // Chỉ đụng vào DẤU CHẤM (số không đổi — vd backspace ngay sau dấu chấm): React sẽ không
      // render lại nên phải tự khôi phục chuỗi hiển thị + đặt con trỏ nhảy QUA dấu chấm
      const node = inputRef.current;
      try {
        if (Platform.OS === "web" && node && typeof node.setSelectionRange === "function") {
          node.value = formatted;
          node.setSelectionRange(pos, pos);
        } else if (node && typeof node.setNativeProps === "function") {
          node.setNativeProps({ text: formatted, selection: { start: pos, end: pos } });
          setTimeout(() => node.setNativeProps?.({ selection: null }), 0);
        }
      } catch {}
      return;
    }
    pendingCaret.current = Math.min(pos, formatted.length);
    onChangeValue(rawDigits);
  };

  return (
    <TextInput
      {...rest}
      ref={inputRef}
      value={display}
      keyboardType="number-pad"
      onChangeText={handleChange}
      style={style}
    />
  );
}
