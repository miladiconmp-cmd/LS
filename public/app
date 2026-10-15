const $ = (id) => document.getElementById(id);

function cell(tr, text) {
  const td = document.createElement('td');
  td.textContent = text ?? '';
  tr.appendChild(td);
  return td;
}

function say(text, ok = true) {
  const m = $('msg');
  m.textContent = text;
  m.className = ok ? 'ok' : 'bad';
}

async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-api-key': $('key').value },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'حدث خطأ');
  return data;
}

async function loadBooks() {
  try {
    const r = await api('/api/books?limit=100&q=' + encodeURIComponent($('q').value));
    const body = $('books');
    body.replaceChildren();
    r.data.forEach((b) => {
      const tr = document.createElement('tr');
      cell(tr, b.id); cell(tr, b.title); cell(tr, b.author); cell(tr, b.category);
      const av = cell(tr, b.available_copies);
      av.className = Number(b.available_copies) > 0 ? 'ok' : 'bad';
      body.appendChild(tr);
    });
    $('count').textContent = `إجمالي النتائج: ${r.total}`;
    if (!$('admin').hidden) fillBookSelect(r.data);
  } catch (e) { say(e.message, false); }
}

function fillBookSelect(books) {
  const s = $('bsel');
  s.replaceChildren();
  books.forEach((b) => s.add(new Option(`${b.title} (${b.available_copies})`, b.id)));
}

async function unlock() {
  try {
    const users = await api('/api/users');
    $('admin').hidden = false;
    const s = $('usel');
    s.replaceChildren();
    users.forEach((u) => s.add(new Option(u.name, u.id)));
    say('تم تسجيل الدخول');
    await loadBooks();
    await loadLoans();
  } catch (e) { say(e.message, false); }
}

async function addBook() {
  try {
    await api('/api/books', 'POST', {
      title: $('t').value, author: $('a').value,
      category: $('c').value, copies: Number($('n').value),
    });
    say('تمت إضافة الكتاب');
    ['t', 'a', 'c'].forEach((i) => ($(i).value = ''));
    loadBooks();
  } catch (e) { say(e.message, false); }
}

async function borrow() {
  try {
    await api('/api/loans', 'POST', {
      book_id: Number($('bsel').value),
      user_id: Number($('usel').value),
      days: Number($('days').value),
    });
    say('تمت الاستعارة');
    loadBooks(); loadLoans();
  } catch (e) { say(e.message, false); }
}

async function loadLoans() {
  try {
    const loans = await api('/api/loans?status=active');
    const body = $('loans');
    body.replaceChildren();
    loans.forEach((l) => {
      const tr = document.createElement('tr');
      cell(tr, l.book_title); cell(tr, l.user_name);
      const due = cell(tr, new Date(l.due_date).toLocaleDateString('ar-EG'));
      if (new Date(l.due_date) < new Date()) due.className = 'bad';
      const td = document.createElement('td');
      const b = document.createElement('button');
      b.className = 'sec'; b.textContent = 'إرجاع';
      b.onclick = () => returnLoan(l.id);
      td.appendChild(b); tr.appendChild(td);
      body.appendChild(tr);
    });
  } catch (e) { say(e.message, false); }
}

async function returnLoan(id) {
  try {
    await api(`/api/loans/${id}/return`, 'POST');
    say('تم الإرجاع');
    loadBooks(); loadLoans();
  } catch (e) { say(e.message, false); }
}

$('searchBtn').addEventListener('click', loadBooks);
$('unlockBtn').addEventListener('click', unlock);
$('addBtn').addEventListener('click', addBook);
$('borrowBtn').addEventListener('click', borrow);
$('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadBooks(); });
loadBooks();
