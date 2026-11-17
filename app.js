const el = (id) => document.getElementById(id);
const labels = {status: "בדיקת תור", reschedule: "שינוי תור", handoff: "העברה לנציג"};
const auditLabels = {...labels, settings: "עדכון הגדרות", appointment_upsert: "קליטת תור", case_close: "סיום טיפול"};
let credentials = {org: "demo", token: ""};
let dashboard;
let busy = false;
let history = [];
let pending;
let revision = 0;
let caseFilter = "waiting";
let activeView = "inbox";
let selectedCaseId;

async function api(path, data, connection = credentials) {
  const res = await fetch("/api/v1/" + path, {
    method: data ? "POST" : "GET",
    headers: {"Content-Type": "application/json", "X-Organization": connection.org,
      Authorization: connection.token ? "Bearer " + connection.token : ""},
    body: data ? JSON.stringify(data) : undefined,
  });
  const payload = await res.json();
  if (!res.ok) {
    const error = new Error(payload.error);
    error.status = res.status;
    throw error;
  }
  return payload;
}

function message(text, customer = false, speak = true) {
  history.push(text);
  const bubble = document.createElement("div");
  bubble.className = customer ? "message customer" : "message";
  const speaker = document.createElement("span");
  speaker.className = "speaker";
  speaker.textContent = customer ? "לקוח" : "מענה אוטומטי";
  const content = document.createElement("p");
  content.textContent = text;
  bubble.append(speaker, content);
  el("messages").append(bubble);
  el("messages").scrollTop = el("messages").scrollHeight;
  if (!customer && speak && el("speak").checked && window.speechSynthesis) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "he-IL";
    speechSynthesis.speak(utterance);
  }
}

function list(id, values, empty, describe) {
  const target = el(id);
  target.replaceChildren();
  if (!values.length) {
    const fallback = document.createElement("p");
    fallback.className = "empty";
    fallback.textContent = empty;
    target.append(fallback);
  }
  for (const value of values) {
    const item = document.createElement("div");
    item.className = "item";
    describe(item, value);
    target.append(item);
  }
}

function formatSlot(slot) {
  return new Intl.DateTimeFormat("he-IL", {dateStyle: "medium", timeStyle: "short"})
    .format(new Date(slot));
}

const caseDates = new Intl.DateTimeFormat("he-IL", {
  dateStyle: "short", timeStyle: "short", timeZone: "Asia/Jerusalem",
});

function caseDate(value) {
  return new Date(value.replace(" ", "T") + "Z");
}

function render(data) {
  const previous = dashboard;
  dashboard = data;
  if (!selectedCase()) selectedCaseId = data.cases.find((item) => item.status === caseFilter)?.id;
  el("org-name").textContent = data.profile.name;
  const identity = data.identity;
  el("settings-open").hidden = identity?.role !== "manager";
  el("audit-open").hidden = identity?.role !== "manager";
  el("actor-label").hidden = !identity || credentials.org === "demo";
  if (identity) {
    const roleLabel = identity.role === "manager" ? "מנהל/ת" : "נציג/ה";
    el("actor-label").textContent = roleLabel + " · " + identity.actor;
  }
  const select = el("appointment");
  const selected = select.value;
  if (JSON.stringify(previous?.appointments) !== JSON.stringify(data.appointments)) {
    select.replaceChildren(...data.appointments.map((a) => new Option(a.customer + " · " + a.id, a.id)));
    if (data.appointments.some((a) => a.id === selected)) select.value = selected;
  }
  if (JSON.stringify(previous?.cases) !== JSON.stringify(data.cases)) renderCases();
  renderCase();
  renderCustomer();
  list("activity", data.activity, "טרם בוצעו פעולות", (item, value) => {
    const action = JSON.parse(value.input);
    item.textContent = labels[action.action] + " · " + action.appointmentId;
  });
}

function renderCustomer() {
  const current = activeView === "inbox" ? selectedCase() : undefined;
  const reference = current?.summary.replace(/ · \d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "");
  const appointment = dashboard?.appointments.find((item) => {
    if (activeView === "conversation") return item.id === el("appointment").value;
    return reference?.endsWith(" | תור " + item.id) && item.customer === current.customer;
  });
  const name = current?.customer ?? appointment?.customer;
  el("customer-context").hidden = !name;
  el("customer-empty").hidden = Boolean(name);
  if (!name) return;
  el("customer-name").textContent = name;
  el("customer-initials").textContent = name.trim().split(/\s+/).slice(0, 2)
    .map((part) => Array.from(part)[0]).join("");
  el("customer-id").textContent = appointment?.id ?? "—";
  el("customer-slot").textContent = appointment ? formatSlot(appointment.slot) : "—";
}

function selectedCase() {
  return dashboard?.cases.find((item) => item.id === selectedCaseId);
}

function renderCase() {
  const current = selectedCase();
  el("case-empty").hidden = Boolean(current);
  el("case-content").hidden = !current;
  el("case-meta").hidden = !current;
  el("case-status").hidden = !current;
  el("case-close").hidden = current?.status !== "waiting";
  el("case-heading").textContent = current?.customer ?? "טיפול בפנייה";
  if (!current) return;
  el("case-id").textContent = "פנייה #" + current.id;
  const created = caseDate(current.created);
  el("case-created").dateTime = created.toISOString();
  el("case-created").textContent = caseDates.format(created);
  const transcript = current.summary.replace(/ \| תור (?:(?! \| תור ).)+ · \d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/s, "");
  el("case-summary").replaceChildren(...transcript.split(" / ").map((line) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = line;
    return paragraph;
  }));
  el("case-status").dataset.status = current.status;
  el("case-status").textContent = current.status === "waiting" ? "ממתינה לטיפול" : "סגורה";
}

function switchView(view) {
  activeView = view;
  el("workspace-title").textContent = view === "inbox" ? "תיבת פניות" : "שיחת לקוח";
  el("case-panel").hidden = view !== "inbox";
  el("conversation-panel").hidden = view !== "conversation";
  el("inbox-view").setAttribute("aria-pressed", String(view === "inbox"));
  el("conversation-view").setAttribute("aria-pressed", String(view === "conversation"));
  if (dashboard) renderCases();
  renderCase();
  renderCustomer();
}

el("inbox-view").onclick = () => switchView("inbox");
el("conversation-view").onclick = () => switchView("conversation");
el("case-close").onclick = () => run(async () => {
  const current = selectedCase();
  if (!current || current.status !== "waiting") return;
  const close = el("case-close");
  close.disabled = true;
  try {
    await api("cases/close", {id: current.id});
    el("case-heading").focus();
    await refreshAfterAction();
  } finally {
    close.disabled = false;
  }
});

function renderCases() {
  el("case-count").textContent = dashboard.cases.filter((c) => c.status === "waiting").length;
  const query = el("case-search").value.trim().replace(/^#/, "").toLocaleLowerCase("he-IL");
  const visible = dashboard.cases.filter((c) => c.status === caseFilter &&
    (c.customer.toLocaleLowerCase("he-IL").includes(query) || c.id.includes(query)));
  const empty = query ? "לא נמצאו פניות שמתאימות לחיפוש" :
    caseFilter === "waiting" ? "אין פניות ממתינות לנציג" : "אין פניות סגורות";
  list("cases", visible, empty, (item, c) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "case-row";
    row.setAttribute("aria-pressed", String(activeView === "inbox" && c.id === selectedCaseId));
    const customer = document.createElement("strong");
    const reference = document.createElement("bdi");
    const preview = document.createElement("span");
    customer.textContent = c.customer;
    reference.textContent = "#" + c.id;
    reference.className = "case-reference";
    preview.className = "case-preview";
    preview.textContent = c.summary.split(" | תור ")[0].split(" / ").at(-1);
    row.append(customer, reference, preview);
    row.onclick = () => {
      selectedCaseId = c.id;
      switchView("inbox");
      el("case-heading").focus();
    };
    item.append(row);
  });
}

document.querySelectorAll("[data-case-filter]").forEach((button, _, filters) => {
  button.onclick = () => {
    caseFilter = button.dataset.caseFilter;
    for (const filter of filters) filter.setAttribute("aria-pressed", String(filter === button));
    if (dashboard) {
      selectedCaseId = dashboard.cases.find((item) => item.status === caseFilter)?.id;
      renderCases();
      renderCase();
      renderCustomer();
    }
  };
});
el("case-search").oninput = () => { if (dashboard) renderCases(); };
document.querySelectorAll("[data-request]").forEach((button) => {
  button.onclick = () => {
    el("utterance").value = button.dataset.request;
    el("utterance").focus();
  };
});

async function refreshAfterAction() {
  revision += 1;
  try {
    render(await api("dashboard"));
  } catch {
    el("notice").textContent = "הפעולה נשמרה. התצוגה תתעדכן כשהחיבור יחזור.";
  }
}

function resetConversation() {
  history = [];
  pending = undefined;
  el("reschedule").hidden = true;
  el("slot").value = "";
  el("messages").replaceChildren();
  message(dashboard.profile.welcome, false, false);
}

async function run(task) {
  if (busy) return;
  busy = true;
  document.querySelector("main").setAttribute("aria-busy", "true");
  el("notice").textContent = "";
  try {
    await task();
  } catch (error) {
    el("notice").textContent = error.message;
  } finally {
    busy = false;
    document.querySelector("main").removeAttribute("aria-busy");
  }
}

function selectedAppointment() {
  const appointment = dashboard?.appointments.find((a) => a.id === el("appointment").value);
  if (!appointment) throw new Error("נדרש תור כדי להפעיל את התרחיש");
  return appointment;
}

async function execute(action, extra = {}) {
  const payload = {action, appointmentId: selectedAppointment().id, ...extra};
  const signature = JSON.stringify(payload);
  const requestId = pending?.signature === signature ? pending.requestId : crypto.randomUUID();
  pending = {signature, requestId};
  try {
    const result = await api("operations", {...payload, requestId});
    pending = undefined;
    return result;
  } catch (error) {
    if (error.status && error.status < 500) pending = undefined;
    throw error;
  }
}

el("chat").onsubmit = (event) => {
  event.preventDefault();
  run(async () => {
    const text = el("utterance").value.trim();
    if (!text) return;
    el("utterance").value = "";
    message(text, true);
    if (/נציג|נציגת|בן אדם|אנושי/.test(text)) {
      const summary = pending?.summary || history.slice(-6).join(" / ").slice(-900);
      try {
        const result = await execute("handoff", {summary});
        message("הפנייה הועברה לתור הנציגים. מספר הפנייה " + result.caseId);
        await refreshAfterAction();
      } catch (error) {
        if (pending) pending.summary = summary;
        throw error;
      }
    } else if (/לשנות|להזיז|שינוי|לדחות|להקדים|להעביר/.test(text)) {
      const appointment = selectedAppointment();
      el("slot").value = appointment.slot;
      el("reschedule").dataset.previousSlot = appointment.slot;
      el("reschedule").hidden = false;
      message("בחרו מועד חדש ואשרו את השינוי.");
      el("slot").focus();
    } else if (/סטטוס|מתי|תור|מועד/.test(text)) {
      const result = await execute("status");
      message("התור רשום ל־" + formatSlot(result.appointment.slot));
      await refreshAfterAction();
    } else {
      message("אפשר לבדוק את מועד התור, לבקש שינוי או לעבור לנציג.");
    }
  });
};

el("reschedule").onsubmit = (event) => {
  event.preventDefault();
  run(async () => {
    const result = await execute("reschedule", {
      slot: el("slot").value, previousSlot: el("reschedule").dataset.previousSlot,
    });
    el("reschedule").hidden = true;
    message("התור עודכן ל־" + formatSlot(result.appointment.slot));
    await refreshAfterAction();
  });
};

el("appointment").onchange = () => {
  if (!dashboard) return;
  resetConversation();
  renderCustomer();
};
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!Recognition) el("mic").hidden = true;
el("mic").onclick = () => {
  if (!Recognition || busy) return;
  const recognition = new Recognition();
  recognition.lang = "he-IL";
  recognition.onresult = (event) => {
    el("utterance").value = event.results[0][0].transcript;
    el("utterance").focus();
  };
  recognition.onerror = () => {
    el("notice").textContent = "זיהוי הדיבור לא הצליח. אפשר להקליד את הבקשה.";
  };
  recognition.onend = () => { el("mic").disabled = false; };
  el("mic").disabled = true;
  try { recognition.start(); }
  catch { el("mic").disabled = false; }
};

el("connect-open").onclick = () => {
  el("connect").elements.org.value = credentials.org;
  el("connect-error").textContent = "";
  el("connect-dialog").showModal();
};
el("connect").onsubmit = async (event) => {
  event.preventDefault();
  const fields = new FormData(event.currentTarget);
  const next = {org: fields.get("org").trim(), token: fields.get("token").trim()};
  const submit = event.submitter;
  submit.disabled = true;
  try {
    const data = await api("dashboard", undefined, next);
    credentials = next;
    selectedCaseId = undefined;
    el("case-search").value = "";
    dashboard = undefined;
    revision += 1;
    render(data);
    resetConversation();
    el("connect").elements.token.value = "";
    el("connect-dialog").close();
  } catch (error) {
    el("connect-error").textContent = error.message;
  } finally {
    submit.disabled = false;
  }
};
el("settings-open").onclick = () => {
  if (!dashboard) return;
  const fields = el("settings").elements;
  fields.name.value = dashboard.profile.name;
  fields.welcome.value = dashboard.profile.welcome;
  el("settings-error").textContent = "";
  el("settings-dialog").showModal();
};
el("audit-open").onclick = async () => {
  const dialog = el("audit-dialog");
  const status = el("audit-status");
  const table = el("audit-table");
  const eventsList = el("audit-events");
  const connection = credentials;
  const request = Symbol();
  dialog.auditRequest = request;
  table.hidden = true;
  eventsList.replaceChildren();
  status.textContent = "טוען פעולות…";
  dialog.showModal();
  try {
    const {events} = await api("audit", undefined, connection);
    if (!dialog.open || dialog.auditRequest !== request || credentials !== connection) return;
    const format = new Intl.DateTimeFormat("he-IL", {dateStyle: "short", timeStyle: "short", timeZone: "Asia/Jerusalem"});
    for (const event of events) {
      const row = eventsList.insertRow();
      const date = new Date(event.created.replace(" ", "T") + "Z");
      for (const value of [auditLabels[event.action] ?? event.action, event.actor, event.target, format.format(date)]) {
        row.insertCell().textContent = value;
      }
    }
    table.hidden = events.length === 0;
    status.textContent = events.length ? "" : "אין פעולות מתועדות.";
  } catch (error) {
    if (dialog.open && dialog.auditRequest === request) status.textContent = error.message;
  }
};
el("settings").onsubmit = async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const submit = event.submitter;
  submit.disabled = true;
  try {
    await api("settings", data);
    await refreshAfterAction();
    el("settings-dialog").close();
  } catch (error) {
    el("settings-error").textContent = error.message;
  } finally {
    submit.disabled = false;
  }
};
document.querySelectorAll(".cancel").forEach((button) => {
  button.onclick = () => button.closest("dialog").close();
});

run(async () => { render(await api("dashboard")); resetConversation(); });
setInterval(async () => {
  if (busy || !dashboard || document.querySelector("dialog[open]")) return;
  const started = revision;
  try {
    const data = await api("dashboard");
    if (revision === started && !busy) render(data);
  } catch {
    el("notice").textContent = "החיבור למוקד התנתק. המערכת תנסה לרענן שוב.";
  }
}, 5000);
