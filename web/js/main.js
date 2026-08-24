// HER homepage — xử lý gửi form (đã nối API thật theo README của mẫu).
const ENDPOINT =
  location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'http://localhost:4000/api/leads'
    : 'https://api.her-pilates.com/api/leads';

// Nhãn trên giao diện -> key bộ môn của backend
const MON_KEY = { 'Pilates': 'pilates', 'Yoga': 'yoga', 'Gym': 'gym', 'Boxing': 'boxing', 'Chưa rõ, cần tư vấn': 'khac' };

function collect(form) {
  const fd = new FormData(form);
  const raw = Object.fromEntries(fd.entries());
  const chips = [...form.querySelectorAll('input[name="mon"]:checked')].map((c) => c.value);
  // Map về payload API /api/leads: interest = môn đầu tiên; chọn nhiều môn thì ghi hết vào note
  const data = { phone: (raw.phone || '').trim(), website: raw.website || '' };
  if (raw.name) data.name = raw.name.trim();
  if (chips.length) {
    data.interest = MON_KEY[chips[0]] || 'khac';
    if (chips.length > 1) data.note = 'Quan tâm: ' + chips.join(', ');
  }
  return data;
}

// Modal thông báo kết quả gửi form — bấm Đóng hoặc bấm nền để tắt
let overlay;
function modal(title, text, isError) {
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = '<div class="modal"><span class="mark"></span><h3></h3><p></p><button class="btn" type="button">Đóng</button></div>';
    document.body.appendChild(overlay);
    const close = () => overlay.classList.remove('show');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.btn').addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }
  overlay.querySelector('.mark').textContent = isError ? '—' : '✓';
  overlay.querySelector('.mark').style.color = isError ? '#8C3A3A' : 'var(--accent)';
  overlay.querySelector('h3').textContent = title;
  overlay.querySelector('p').textContent = text;
  overlay.classList.add('show');
}

async function submit(form) {
  const btn = form.querySelector('.btn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Đang gửi...';
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collect(form)),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Gửi chưa được — bạn thử lại giúp HER nhé.');
    btn.textContent = 'Đã gửi — HER sẽ gọi lại';
    modal('Đã nhận thông tin', (body.message || 'HER sẽ gọi lại cho bạn sớm nhất!').replace(/^Đã nhận thông tin( của bạn rồi)? — /, ''), false);
    form.reset();
  } catch (e) {
    btn.textContent = 'Gửi thất bại, thử lại';
    modal('Gửi chưa được', e.message.startsWith('Failed') || e.message.startsWith('Load') ? 'Không kết nối được máy chủ — bạn kiểm tra mạng hoặc gọi 070 308 9980 nhé.' : e.message, true);
  } finally {
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = label;
    }, 3200);
  }
}

// ---- F5 luôn về ĐẦU TRANG: tắt khôi phục vị trí cuộn của trình duyệt + dọn hash cũ trên URL ----
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
window.scrollTo(0, 0);

// ---- Điều hướng trong trang: cuộn mượt, KHÔNG đổi URL (F5 không bị nhảy xuống) ----
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    const target = document.querySelector(a.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: 'smooth' });
  });
});

// ---- Cảm nhận: xoay 3 quote theo 3 chấm ----
const QUOTES = [
  { text: '“Đợt em bị lệch hông, tập ở đây thấy chắc chắn hơn hẳn — được chỉnh từng chút nên rất yên tâm.”', by: 'Học viên Pilates Reformer' },
  { text: '“Nay tập ổn hơn nhiều, đỡ nhức mỏi hẳn. Cảm ơn cô giáo đã chỉnh lại dáng cho em.”', by: 'Học viên lớp kèm 1:2' },
  { text: '“Mọi người nói eo con nhỏ lại thấy rõ — mà vui nhất là thấy mình khoẻ và tự tin hơn.”', by: 'Học viên sau 2 tháng' },
];
const qBody = document.querySelector('.quote-body');
if (qBody) {
  const bq = qBody.querySelector('blockquote');
  const ct = qBody.querySelector('cite');
  const dots = [...qBody.querySelectorAll('.dots i')];
  let cur = 0, timer;
  function show(i) {
    cur = i;
    qBody.classList.add('switching');
    setTimeout(() => {
      bq.textContent = QUOTES[i].text;
      ct.textContent = QUOTES[i].by;
      dots.forEach((d, j) => d.classList.toggle('on', j === i));
      qBody.classList.remove('switching');
    }, 350);
  }
  function auto() { timer = setInterval(() => show((cur + 1) % QUOTES.length), 6000); }
  dots.forEach((d, i) => d.addEventListener('click', () => { clearInterval(timer); show(i); auto(); }));
  auto();
}

document.querySelectorAll('form[data-lead]').forEach((form) => {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(form);
  });
});
