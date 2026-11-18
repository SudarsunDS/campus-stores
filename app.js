(() => {
  "use strict";

  /* ------------------------------------------------------------------
   * Campus Stores · media equipment desk
   *
   * The desk keeps one slip per physical unit (unchanged from the
   * original). This version adds a request-level lifecycle on top of
   * those slips: issue a whole approved kit, record partial returns with
   * structured custody (who has it now, when it is expected back), and
   * close a loan only after the tag on the unit in hand is confirmed.
   *
   * Every change to the records runs through `transact`, which works on
   * a copy of the state and only swaps it in when every rule passes, so
   * a failed multi-item operation never leaves a half-applied record.
   * ------------------------------------------------------------------ */

  const storageKey = "campus-stores.shift.v2";
  const legacyKey = "campus-stores.shift.v1";
  const root = document.getElementById("campus-stores");
  const q = (selector) => root.querySelector(selector);

  /* ---------- Sample records (unchanged from the original exercise) ---------- */

  const requests = [
    {
      id: "RQ-214",
      club: "Film Society",
      event: "Courtyard screening",
      owner: "Isha Rao",
      due: "Fri 8 pm",
      items: ["HDMI projector", "Portable speaker", "USB-C → HDMI adapter"],
      note: "Playback is from a USB-C-only laptop. The host will collect at 4 pm.",
    },
    {
      id: "RQ-209",
      club: "Debate Union",
      event: "Finals rehearsal",
      owner: "Tara Shah",
      due: "Sat 10 am",
      items: ["Wireless microphone"],
      note: "Rehearsal runs into the evening.",
    },
    {
      id: "RQ-217",
      club: "Photo Circle",
      event: "Street portrait walk",
      owner: "Dev Menon",
      due: "Sat noon",
      items: ["Digital camera"],
      note: "Collection on Saturday morning.",
    },
  ];
  const assets = [
    { id: "PR-04", type: "HDMI projector", model: "BenQ MH550", bin: "A2" },
    {
      id: "PR-06",
      type: "HDMI projector",
      model: "Epson EB-X49",
      bin: "Workshop",
      repair: true,
    },
    { id: "SP-02", type: "Portable speaker", model: "JBL Eon One", bin: "B1" },
    { id: "SP-05", type: "Portable speaker", model: "Bose S1", bin: "B2" },
    {
      id: "AD-12",
      type: "USB-C → HDMI adapter",
      model: "Belkin AVC002",
      bin: "C4",
    },
    {
      id: "AD-15",
      type: "USB-C → HDMI adapter",
      model: "Anker A8312",
      bin: "C4",
    },
    { id: "MI-09", type: "Wireless microphone", model: "Shure BLX", bin: "B3" },
    { id: "CA-03", type: "Digital camera", model: "Sony A6400", bin: "D2" },
  ];
  const people = [
    "Isha Rao",
    "Kabir Sen",
    "Leela Das",
    "Tara Shah",
    "Dev Menon",
  ];
  // `at` is minutes from Friday 00:00 so desk time and return times compare.
  const shifts = [
    {
      time: "Friday · 3:45 pm",
      at: 945,
      title: "Pickup at the counter",
      text: "Kabir is here for the Film Society screening. The film starts at four. Can he leave with everything he needs?",
      next: "Move to return time",
    },
    {
      time: "Friday · 7:30 pm",
      at: 1170,
      title: "The kit comes back in pieces",
      text: "Kabir has brought back the projector and speaker. “Leela still has the adapter. She’ll drop it off tomorrow at nine.” Take the return and hand over to the morning shift.",
      next: "Move to next morning",
    },
    {
      time: "Saturday · 9:00 am",
      at: 1980,
      title: "Morning shift",
      text: "You’ve just taken over. Leela walks in with an adapter. Work out what was outstanding from the screening and close the loan for the right item.",
    },
  ];
  const returnTimes = {
    "Fri 8 pm": 1200,
    "Sat 9 am": 1980,
    "Sat 10 am": 2040,
    "Sat noon": 2160,
  };
  const messages = [
    {
      phase: 0,
      time: "Friday · 3:20 pm",
      author: "Isha Rao · Film Society",
      req: "RQ-214",
      text: "Kabir Sen is picking up our whole screening kit. Please issue it in his name. I’m setting up in the courtyard.",
    },
    {
      phase: 0,
      time: "Friday · 3:30 pm",
      author: "Tara Shah · Debate Union",
      req: "RQ-209",
      text: "Our microphone stays with me overnight. I’ll return it by 10 am Saturday.",
    },
    {
      phase: 1,
      time: "Friday · 7:30 pm",
      author: "Kabir Sen · Film Society",
      req: "RQ-214",
      text: "I brought the projector and speaker. Leela Das has our adapter. She’ll be at the counter at 9 am tomorrow.",
    },
  ];
  const pages = [
    ["Counter", "inbox"],
    ["Requests", "clipboard-list"],
    ["Inventory", "package"],
    ["Loan register", "book-open"],
    ["Desk book", "messages-square"],
  ];
  const filters = ["All items", "On shelf", "On loan", "In repair"];

  const slip = (num, req, asset, who, due, issuedPhase = null) => ({
    num,
    req,
    asset,
    who,
    due,
    back: false,
    holder: "",
    expected: "",
    issuedPhase,
    returnedBy: "",
    returnedPhase: null,
  });
  const original = () => ({
    version: 2,
    tab: "Counter",
    phase: 0,
    selected: "",
    filter: "All items",
    onlyOpen: true,
    query: "",
    loans: [slip(401, "RQ-209", "MI-09", "Tara Shah", "Sat 10 am")],
    notes: [],
    notice: "Sample shift · All records are fictional.",
  });

  let s = original();
  // Screen-only state: never persisted.
  const blankUi = () => ({ form: null, values: null, errors: {}, focus: null });
  let ui = blankUi();
  let undo = null;

  /* ---------- Lookups and derived state ---------- */

  const getAsset = (id) => assets.find((a) => a.id === id);
  const getReq = (id) => requests.find((r) => r.id === id);
  const typeOf = (l) => getAsset(l.asset).type;
  const openLoanIn = (st, id) => st.loans.find((l) => l.asset === id && !l.back);
  const out = (id) => openLoanIn(s, id);
  const holderOf = (l) => l.holder || l.who;
  const expectedOf = (l) => l.expected || l.due;
  const nowAt = (st = s) => shifts[st.phase].at;
  const laterTimes = (st = s) =>
    Object.keys(returnTimes).filter((t) => returnTimes[t] > nowAt(st));
  const nextNum = (st) => Math.max(400, ...st.loans.map((l) => l.num)) + 1;
  const normTag = (x) =>
    String(x ?? "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
  const describe = (l) => l.asset + " " + typeOf(l);
  const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");
  const slipRange = (nums) =>
    nums.length === 1
      ? "slip L-" + nums[0]
      : "slips L-" + nums[0] + "–L-" + nums[nums.length - 1];

  function loanState(l) {
    if (l.back) return { key: "returned", label: "Returned" };
    const due = returnTimes[expectedOf(l)];
    if (due < nowAt()) return { key: "overdue", label: "Overdue" };
    if (due === nowAt()) return { key: "due", label: "Due now" };
    return { key: "out", label: "On loan" };
  }
  function assetStatus(a) {
    if (a.repair) return { key: "repair", label: "In repair" };
    const l = out(a.id);
    if (!l) return { key: "shelf", label: "On shelf" };
    const st = loanState(l);
    return st.key === "overdue" ? st : { key: "out", label: "On loan" };
  }

  // A request viewed as a job: each approved item, the slip that covers it,
  // and an overall status the desk can act on.
  function job(r) {
    const lines = r.items.map((type, i) => {
      const slips = s.loans.filter((l) => l.req === r.id && typeOf(l) === type);
      return {
        type,
        i,
        slip: slips.find((l) => !l.back) || slips[slips.length - 1] || null,
      };
    });
    const issued = lines.filter((x) => x.slip).length;
    const open = lines.filter((x) => x.slip && !x.slip.back).map((x) => x.slip);
    const back = issued - open.length;
    const overdue = open.some((l) => loanState(l).key === "overdue");
    const n = lines.length;
    let status;
    if (!issued) status = { key: "ready", label: "Ready to issue" };
    else if (!open.length)
      status =
        issued === n
          ? { key: "complete", label: "Complete" }
          : { key: "partial", label: back + " of " + n + " returned" };
    else if (overdue) status = { key: "overdue", label: "Overdue" };
    else if (back) status = { key: "partial", label: back + " of " + n + " back" };
    else
      status = {
        key: "out",
        label: issued === n ? "Out" : issued + " of " + n + " out",
      };
    return {
      lines,
      open,
      back,
      issued,
      status,
      unissued: lines.filter((x) => !x.slip),
    };
  }
  function jobSummary(r, j = job(r)) {
    const parts = [];
    if (!j.issued) return "Nothing issued yet";
    if (j.back) parts.push(j.back + " of " + j.lines.length + " back");
    const byHolder = {};
    for (const l of j.open) {
      const h = holderOf(l);
      byHolder[h] = (byHolder[h] || 0) + 1;
    }
    for (const [h, n] of Object.entries(byHolder))
      parts.push(n + " out with " + h);
    if (j.unissued.length && j.issued) parts.push(j.unissued.length + " not issued");
    return parts.join(" · ") || "All returned";
  }

  /* ---------- HTML helpers ---------- */

  const esc = (x) =>
    String(x).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const icon = (id, cls = "") =>
    '<svg aria-hidden="true" class="store-icon ' +
    cls +
    '"><use href="#icon-' +
    id +
    '"></use></svg>';
  const btn = (label, act, val = "", style = "", aria = "", ic = "") =>
    '<button type="button" data-action="' +
    act +
    '" data-val="' +
    esc(val) +
    '" class="' +
    style +
    '"' +
    (aria ? ' aria-label="' + esc(aria) + '"' : "") +
    ">" +
    (ic ? icon(ic) : "") +
    esc(label) +
    "</button>";
  const chipIcons = { overdue: "alert", complete: "check", due: "clock", shelf: "check" };
  const chip = (key, label) =>
    '<span class="chip chip-' +
    key +
    '">' +
    (chipIcons[key] ? icon(chipIcons[key]) : "") +
    esc(label) +
    "</span>";
  const head = (title, sub, control = "") =>
    '<div class="sectionhead"><div><h2 tabindex="-1">' +
    title +
    "</h2><small>" +
    sub +
    "</small></div>" +
    control +
    "</div>";
  const describedBy = (name, err, hint) => {
    const ids = [hint && "h-" + name, err && "e-" + name].filter(Boolean);
    return (
      (ids.length ? ' aria-describedby="' + ids.join(" ") + '"' : "") +
      (err ? ' aria-invalid="true"' : "")
    );
  };
  const fieldError = (name, err) =>
    err
      ? '<p class="fielderror" id="e-' +
        name +
        '">' +
        icon("alert") +
        "<span>" +
        esc(err) +
        "</span></p>"
      : "";
  const selectCtl = (name, options, value, err, hint, placeholder = "Select…", disabled = false) =>
    '<select id="f-' +
    name +
    '" name="' +
    name +
    '"' +
    describedBy(name, err, hint) +
    (disabled ? " disabled" : "") +
    ">" +
    (placeholder !== null ? '<option value="">' + esc(placeholder) + "</option>" : "") +
    options
      .map(
        ([v, t]) =>
          '<option value="' +
          esc(v) +
          '"' +
          (v === value ? " selected" : "") +
          ">" +
          esc(t) +
          "</option>",
      )
      .join("") +
    "</select>";
  const inputCtl = (name, value, err, hint, attrs = "") =>
    '<input id="f-' +
    name +
    '" name="' +
    name +
    '" value="' +
    esc(value) +
    '"' +
    describedBy(name, err, hint) +
    " " +
    attrs +
    " />";
  const field = (label, name, control, err = "", hint = "", cls = "") =>
    '<div class="field ' +
    cls +
    '"><label for="f-' +
    name +
    '">' +
    esc(label) +
    "</label>" +
    (hint ? '<small class="hint" id="h-' + name + '">' + hint + "</small>" : "") +
    control +
    fieldError(name, err) +
    "</div>";
  const tagInput = (name, value, err, hint) =>
    inputCtl(
      name,
      value,
      err,
      hint,
      'type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" class="tag-input"',
    );
  const peopleOpts = () => people.map((p) => [p, p]);
  const timeOpts = () => laterTimes().map((t) => [t, t]);
  function summary() {
    const keys = Object.keys(ui.errors).filter((k) => k !== "_form");
    if (!keys.length && !ui.errors._form) return "";
    const detail =
      ui.errors._form ||
      (keys.length === 1
        ? "Fix the highlighted field and try again."
        : "Fix the " + keys.length + " highlighted fields and try again.");
    return (
      '<div class="errorsummary" role="alert" tabindex="-1">' +
      icon("alert") +
      "<div><strong>Nothing was saved.</strong> " +
      esc(detail) +
      "</div></div>"
    );
  }
  const actions = (label) =>
    '<div class="formactions"><button type="submit" class="primary">' +
    esc(label) +
    "</button>" +
    btn("Cancel", "cancel-form") +
    "</div>";
  const dl = (pairs) =>
    '<dl class="custody">' +
    pairs
      .map(
        ([k, v, strong]) =>
          '<div><dt>' +
          esc(k) +
          "</dt><dd" +
          (strong ? ' class="strong"' : "") +
          ">" +
          esc(v) +
          "</dd></div>",
      )
      .join("") +
    "</dl>";

  /* ---------- Shared slip card ---------- */

  function slipCard(l, opts = {}) {
    const a = getAsset(l.asset);
    const r = getReq(l.req);
    const st = loanState(l);
    const checking = ui.form && ui.form.type === "checkin" && ui.form.num === l.num;
    const moved = l.expected && l.expected !== l.due;
    const custody = l.back
      ? dl([
          ["Returned by", l.returnedBy || "Not recorded"],
          [
            "Returned",
            l.returnedPhase === null ? "Before this record" : shifts[l.returnedPhase].time,
          ],
          ["Collected by", l.who],
        ])
      : dl([
          ["With", holderOf(l), true],
          ["Expected back", expectedOf(l) + (moved ? " (was " + l.due + ")" : ""), true],
          ["Collected by", l.who],
        ]);
    return (
      '<article class="slip is-' +
      st.key +
      (checking ? " is-checking" : "") +
      '" aria-labelledby="slip-' +
      l.num +
      '"><div class="slipbody"><div class="sliptitle"><h3 id="slip-' +
      l.num +
      '">' +
      esc(a.id + " · " + a.type) +
      "</h3>" +
      chip(st.key, st.label) +
      "</div><small>L-" +
      l.num +
      " · " +
      (opts.hideReq ? "" : esc(r.id + " · " + r.club + " · ")) +
      esc(a.model) +
      " · bin " +
      esc(a.bin) +
      "</small>" +
      custody +
      "</div>" +
      (!l.back && !checking
        ? '<div class="slipact">' +
          btn("Check in", "checkin", l.num, "", "Check in " + a.id + ", slip L-" + l.num, "scan") +
          "</div>"
        : "") +
      (checking ? checkinForm(l) : "") +
      "</article>"
    );
  }
  function checkinForm(l) {
    const v = ui.values || {};
    const e = ui.errors;
    return (
      '<form class="inlineform" data-checkin data-num="' +
      l.num +
      '" novalidate>' +
      summary() +
      '<p class="formhint">' +
      icon("scan") +
      "<span>Read the tag label on the unit in hand. Slip L-" +
      l.num +
      " only closes if the tag matches.</span></p>" +
      '<div class="form">' +
      field(
        "Tag on the unit in hand",
        "tag",
        tagInput("tag", v.tag || "", e.tag),
        e.tag,
      ) +
      field(
        "Returned by",
        "returnedBy",
        selectCtl("returnedBy", peopleOpts(), v.returnedBy ?? holderOf(l), e.returnedBy),
        e.returnedBy,
      ) +
      "</div>" +
      actions("Confirm return") +
      "</form>"
    );
  }

  /* ---------- Screens ---------- */

  function counterPage() {
    return (
      head(
        "Counter",
        "Look up whoever is at the counter, then work through what is still out",
      ) +
      '<form class="lookup" data-search role="search" novalidate><label for="lookup">' +
      icon("search") +
      'Who or what is at the counter?</label><input id="lookup" name="q" type="search" autocomplete="off" spellcheck="false" placeholder="Name, unit tag, club or request" value="' +
      esc(s.query) +
      '" aria-describedby="lookup-hint" /><small id="lookup-hint" class="hint">Searches open loans by borrower, current holder, unit tag, equipment, club and request.</small></form>' +
      '<p class="resultcount" data-resultcount aria-live="polite">' +
      esc(resultCount()) +
      "</p><div data-results>" +
      counterResults() +
      "</div>"
    );
  }
  function searchLoans(text) {
    const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
    return s.loans
      .filter((l) => !l.back)
      .filter((l) => {
        const a = getAsset(l.asset);
        const r = getReq(l.req);
        const hay = [
          "L-" + l.num,
          a.id,
          normTag(a.id),
          a.type,
          a.model,
          r.id,
          r.club,
          r.event,
          r.owner,
          l.who,
          holderOf(l),
        ]
          .join(" ")
          .toLowerCase();
        return tokens.every((t) => hay.includes(t) || (normTag(t) && hay.includes(normTag(t).toLowerCase())));
      })
      .reverse();
  }
  function resultCount() {
    const text = s.query.trim();
    if (!text) return "";
    const n = searchLoans(text).length;
    return n
      ? plural(n, "open loan") + " match “" + text + "”"
      : "No open loans match “" + text + "”. Try a unit tag, club or request number.";
  }
  function counterResults() {
    const text = s.query.trim();
    if (text) return searchLoans(text).map((l) => slipCard(l)).join("");
    return handoverSummary();
  }
  function handoverSummary() {
    const open = s.loans.filter((l) => !l.back);
    const overdue = open.filter((l) => loanState(l).key === "overdue").length;
    const dueNow = open.filter((l) => loanState(l).key === "due").length;
    const handedOn = open.filter((l) => l.holder && l.holder !== l.who).length;
    let html =
      '<div class="stats" role="group" aria-label="Open at handover">' +
      [
        ["Open loans", open.length, ""],
        ["Overdue", overdue, overdue ? "bad" : ""],
        ["Due now", dueNow, dueNow ? "warn" : ""],
        ["With someone else", handedOn, ""],
      ]
        .map(
          ([k, v, tone]) =>
            '<div class="stat ' + tone + '"><strong>' + v + "</strong><small>" + k + "</small></div>",
        )
        .join("") +
      "</div>";
    html += '<h3 class="subhead">Open at handover</h3>';
    if (!open.length)
      return html + '<p class="empty">' + icon("check") + "Nothing is out. Every loan is closed.</p>";
    for (const r of requests) {
      const mine = open.filter((l) => l.req === r.id);
      if (!mine.length) continue;
      const j = job(r);
      const last = s.notes.filter((n) => n.req === r.id).slice(-1)[0];
      html +=
        '<section class="group" aria-labelledby="grp-' +
        r.id +
        '"><div class="grouphead"><div><h4 id="grp-' +
        r.id +
        '">' +
        esc(r.event) +
        " " +
        chip(j.status.key, j.status.label) +
        "</h4><small>" +
        esc(r.id + " · " + r.club + " · " + jobSummary(r, j)) +
        "</small></div>" +
        btn("Open request", "request", r.id, "ghost", "Open request " + r.id) +
        "</div>" +
        (last
          ? '<p class="handnote">' +
            icon("messages-square") +
            "<span><b>" +
            esc(shifts[last.phase].time) +
            "</b> " +
            esc(last.text) +
            "</span></p>"
          : "") +
        mine.map((l) => slipCard(l)).join("") +
        "</section>";
    }
    return html;
  }

  function requestPage() {
    if (s.selected) return jobPage(getReq(s.selected));
    return (
      head(
        "Approved requests",
        "Student Activities Office · 3 approved forms · open one to issue or return its kit",
      ) +
      '<ul class="joblist">' +
      requests
        .map((r) => {
          const j = job(r);
          return (
            '<li class="jobrow"><div><strong>' +
            esc(r.event) +
            "</strong><small>" +
            esc(r.id + " · " + r.club + " · Return by " + r.due) +
            '</small><small class="jobsum">' +
            esc(jobSummary(r, j)) +
            '</small></div><div class="jobright">' +
            chip(j.status.key, j.status.label) +
            btn("Open", "request", r.id, "", "Open request " + r.id + ", " + r.event) +
            "</div></li>"
          );
        })
        .join("") +
      "</ul>"
    );
  }
  function jobPage(r) {
    const j = job(r);
    const formType = ui.form && ui.form.req === r.id ? ui.form.type : "";
    const tools =
      formType === "kit" || formType === "return"
        ? ""
        : '<div class="buttons">' +
          (j.unissued.length
            ? btn(j.issued ? "Issue remaining items" : "Issue kit", "kit", r.id, "primary", "", "package")
            : "") +
          (j.open.length ? btn("Record return", "return-form", r.id, j.unissued.length ? "" : "primary", "", "undo") : "") +
          "</div>";
    let html =
      '<div class="crumbs">' +
      btn("All requests", "close", "", "ghost", "Back to all requests", "arrow-left") +
      "</div>" +
      head(
        esc(r.event),
        esc(r.id + " · " + r.club + " · Filed by " + r.owner),
        chip(j.status.key, j.status.label),
      ) +
      '<div class="record"><small>' +
      esc(r.id) +
      " · Approved</small>" +
      dl([
        ["Return by", r.due, true],
        ["Approved equipment", r.items.join(", ")],
      ]) +
      "<p>" +
      esc(r.note) +
      "</p></div>" +
      '<div class="sectionhead sub"><div><h3>Equipment</h3><small>' +
      esc(jobSummary(r, j)) +
      "</small></div>" +
      tools +
      "</div>";
    if (formType === "kit") html += kitForm(r, j);
    if (formType === "return") html += returnForm(r, j);
    html += j.lines
      .map((x) =>
        x.slip
          ? slipCard(x.slip, { hideReq: true })
          : '<article class="slip is-ready"><div class="slipbody"><div class="sliptitle"><h3>' +
            esc(x.type) +
            "</h3>" +
            chip("ready", "Not issued") +
            "</div><small>Approved on " +
            esc(r.id) +
            "</small></div></article>",
      )
      .join("");
    const related = deskEntries().filter((e) => e.req === r.id);
    if (related.length)
      html +=
        '<h3 class="subhead">Desk book for ' +
        esc(r.id) +
        "</h3>" +
        related.map(entryHtml).join("");
    return html;
  }
  function kitForm(r, j) {
    const v = ui.values;
    const e = ui.errors;
    const lines = j.unissued
      .map(({ type, i }) => {
        const avail = assets.filter((a) => a.type === type && !a.repair && !out(a.id));
        const blocked = assets.filter((a) => a.type === type && (a.repair || out(a.id)));
        const take = v ? !!v["take-" + i] : avail.length > 0;
        const unit = v ? v["unit-" + i] || "" : avail[0] ? avail[0].id : "";
        const err = e["unit-" + i];
        const hintId = blocked.length ? "unit-" + i : "";
        return (
          '<div class="kitline' +
          (err ? " has-error" : "") +
          '"><label class="check"><input type="checkbox" name="take-' +
          i +
          '"' +
          (take ? " checked" : "") +
          (avail.length ? "" : " disabled") +
          " /><span><strong>" +
          esc(type) +
          "</strong>" +
          (avail.length ? "" : "<small>No unit on the shelf</small>") +
          '</span></label><div class="kitunit"><label class="sr-only" for="f-unit-' +
          i +
          '">Unit for ' +
          esc(type) +
          "</label>" +
          selectCtl(
            "unit-" + i,
            avail.map((a) => [a.id, a.id + " · " + a.model + " · bin " + a.bin]),
            unit,
            err,
            hintId,
            avail.length ? "Select unit…" : "No unit available",
            !avail.length,
          ) +
          (blocked.length
            ? '<small class="hint" id="h-unit-' +
              i +
              '">Not available: ' +
              esc(
                blocked
                  .map((a) => a.id + (a.repair ? " (in repair)" : " (on loan)"))
                  .join(", "),
              ) +
              "</small>"
            : "") +
          fieldError("unit-" + i, err) +
          "</div></div>"
        );
      })
      .join("");
    const auth = messages.filter(
      (m) => m.req === r.id && m.phase <= s.phase && m.author.startsWith(r.owner),
    );
    const hint = auth.length
      ? "Desk book, " +
        esc(auth[0].time.replace("Friday · ", "Fri ")) +
        " — " +
        esc(r.owner) +
        ": “" +
        esc(auth[0].text) +
        "”"
      : "Filed by " + esc(r.owner) + ". Check the desk book if someone else is collecting.";
    return (
      '<form class="panel" data-kit data-req="' +
      esc(r.id) +
      '" novalidate aria-labelledby="kit-title"><h3 id="kit-title">' +
      (j.issued ? "Issue remaining items" : "Issue kit") +
      " · " +
      esc(r.id) +
      "</h3>" +
      summary() +
      '<p class="formhint">' +
      icon("package") +
      "<span>One slip is saved for each unit. Nothing is saved unless every selected line is valid.</span></p>" +
      '<fieldset class="kitlines"><legend>Units leaving the desk</legend>' +
      lines +
      "</fieldset>" +
      '<div class="form">' +
      field(
        "Collected by",
        "collector",
        selectCtl("collector", peopleOpts(), v ? v.collector : "", e.collector, hint ? "collector" : ""),
        e.collector,
        hint,
      ) +
      field(
        "Return by",
        "due",
        selectCtl(
          "due",
          timeOpts(),
          v ? v.due : laterTimes().includes(r.due) ? r.due : "",
          e.due,
          "due",
        ),
        e.due,
        "Pre-filled from the approved request.",
      ) +
      "</div>" +
      actions("Issue " + plural(j.unissued.length, "item")) +
      "</form>"
    );
  }
  function returnForm(r, j) {
    if (!j.open.length) return "";
    const v = ui.values || {};
    const e = ui.errors;
    const radio = (n, val, label, cur) =>
      '<label class="seg"><input type="radio" name="fate-' +
      n +
      '" value="' +
      val +
      '"' +
      (cur === val ? " checked" : "") +
      (e["fate-" + n] ? ' aria-describedby="e-fate-' + n + '" aria-invalid="true"' : "") +
      " /><span>" +
      esc(label) +
      "</span></label>";
    const rows = j.open
      .map((l) => {
        const n = l.num;
        const fate = v["fate-" + n] || "";
        const keepExpected =
          l.expected && returnTimes[l.expected] > nowAt() ? l.expected : "";
        const bad = ["fate-", "tag-", "holder-", "expected-"].some((k) => e[k + n]);
        return (
          '<fieldset class="returnline' +
          (bad ? " has-error" : "") +
          '"><legend><strong>' +
          esc(describe(l).replace(" ", " · ")) +
          "</strong><small>L-" +
          n +
          " · with " +
          esc(holderOf(l)) +
          " · expected " +
          esc(expectedOf(l)) +
          '</small></legend><div class="segmented">' +
          radio(n, "back", "Back at the counter", fate) +
          radio(n, "out", "Still out", fate) +
          "</div>" +
          fieldError("fate-" + n, e["fate-" + n]) +
          '<div class="when-back form">' +
          field(
            "Tag on the unit in hand",
            "tag-" + n,
            tagInput("tag-" + n, v["tag-" + n] || "", e["tag-" + n], "tag-" + n),
            e["tag-" + n],
            "Read the label. The slip only closes if it matches.",
          ) +
          '</div><div class="when-out form">' +
          field(
            "Who has it now",
            "holder-" + n,
            selectCtl("holder-" + n, peopleOpts(), v["holder-" + n] ?? l.holder, e["holder-" + n]),
            e["holder-" + n],
          ) +
          field(
            "Expected back",
            "expected-" + n,
            selectCtl("expected-" + n, timeOpts(), v["expected-" + n] ?? keepExpected, e["expected-" + n]),
            e["expected-" + n],
          ) +
          "</div></fieldset>"
        );
      })
      .join("");
    return (
      '<form class="panel" data-return data-req="' +
      esc(r.id) +
      '" novalidate aria-labelledby="ret-title"><h3 id="ret-title">Record return · ' +
      esc(r.id) +
      "</h3>" +
      summary() +
      '<p class="formhint">' +
      icon("undo") +
      "<span>Account for every unit still out on this request. Units handed back need their tag confirmed. Anything still out needs who has it now and when it is coming back. Nothing is saved unless every line is complete.</span></p>" +
      rows +
      '<div class="form">' +
      field(
        "Returned by",
        "returnedBy",
        selectCtl("returnedBy", peopleOpts(), v.returnedBy ?? j.open[0].who, e.returnedBy, "returnedBy"),
        e.returnedBy,
        "Who handed the units over the counter.",
      ) +
      "</div>" +
      actions("Save return") +
      "</form>"
    );
  }

  function inventory() {
    let html = head(
      "Inventory",
      "Physical units · home shelf and current availability",
    );
    html +=
      '<div class="buttons"><label class="inline">Show ' +
      selectCtl("filter", filters.map((f) => [f, f]), s.filter, "", "", null) +
      "</label></div>";
    let shown = 0;
    for (const a of assets) {
      const st = assetStatus(a);
      const label = a.repair ? "In repair" : out(a.id) ? "On loan" : "On shelf";
      if (s.filter !== "All items" && s.filter !== label) continue;
      shown++;
      const l = out(a.id);
      html +=
        '<div class="row"><div><strong>' +
        esc(a.id + " · " + a.type) +
        "</strong><small>" +
        esc(a.model + " · bin " + a.bin) +
        "</small>" +
        (l
          ? '<small class="custodyline">' +
            esc(
              "L-" + l.num + " · " + l.req + " · with " + holderOf(l) + " · expected " + expectedOf(l),
            ) +
            "</small>"
          : "") +
        "</div><div>" +
        chip(st.key, st.label) +
        "</div></div>";
    }
    if (!shown) html += '<p class="empty">No units match this filter.</p>';
    return html;
  }

  function register() {
    const editing = ui.form && ui.form.type === "slip";
    let html = head(
      "Loan register",
      "One slip per physical unit",
      editing ? btn("Cancel", "cancel-form") : btn("New issue slip", "new", "", "primary"),
    );
    if (editing) {
      const v = ui.values || {};
      const e = ui.errors;
      const available = assets.filter((a) => !a.repair && !out(a.id));
      return (
        html +
        '<form class="panel" data-issue novalidate aria-label="New issue slip">' +
        summary() +
        '<p class="formhint">' +
        icon("package") +
        "<span>Issuing a whole approved kit? Open the request and use <b>Issue kit</b>.</span></p>" +
        '<div class="form">' +
        field(
          "Approved request",
          "req",
          selectCtl("req", requests.map((r) => [r.id, r.id + " · " + r.club]), v.req || "", e.req),
          e.req,
        ) +
        field(
          "Unit leaving the desk",
          "asset",
          selectCtl("asset", available.map((a) => [a.id, a.id + " · " + a.type]), v.asset || "", e.asset),
          e.asset,
        ) +
        field("Collected by", "who", selectCtl("who", peopleOpts(), v.who || "", e.who), e.who) +
        field("Return by", "due", selectCtl("due", timeOpts(), v.due || "", e.due), e.due) +
        "</div>" +
        actions("Save issue slip") +
        "</form>"
      );
    }
    html +=
      '<div class="buttons" role="group" aria-label="Which slips">' +
      ["Outstanding", "All slips"]
        .map(
          (v, i) =>
            '<button type="button" data-action="scope" data-val="' +
            i +
            '" aria-pressed="' +
            (s.onlyOpen === (i === 0)) +
            '">' +
            v +
            "</button>",
        )
        .join("") +
      "</div>";
    const shown = s.loans
      .filter((l) => !s.onlyOpen || !l.back)
      .slice()
      .reverse();
    if (!shown.length) html += '<p class="empty">' + icon("check") + "No outstanding slips.</p>";
    return html + shown.map((l) => slipCard(l)).join("");
  }

  function deskEntries() {
    const list = messages
      .filter((m) => m.phase <= s.phase)
      .map((m, seq) => ({ ...m, order: 0, seq, kind: "message", slips: [] }));
    s.notes.forEach((n, seq) =>
      list.push({
        phase: n.phase,
        order: 1,
        seq,
        time: shifts[n.phase].time,
        author: n.kind === "auto" ? "Desk record · " + (n.req || "return") : "Counter handover",
        text: n.text,
        kind: n.kind,
        req: n.req,
        slips: n.slips,
      }),
    );
    return list
      .sort((a, b) => a.phase - b.phase || a.order - b.order || a.seq - b.seq)
      .reverse();
  }
  function entryHtml(e) {
    return (
      '<article class="record entry entry-' +
      e.kind +
      '"><small>' +
      esc(e.time) +
      "</small><h3>" +
      esc(e.author) +
      "</h3><p>" +
      esc(e.text) +
      "</p>" +
      (e.kind === "auto" && e.slips.length
        ? '<p class="links">' +
          e.slips.map((n) => '<span class="chip chip-link">L-' + n + "</span>").join("") +
          "</p>"
        : "") +
      "</article>"
    );
  }
  function deskbook() {
    const e = ui.errors;
    const v = ui.values || {};
    return (
      head("Desk book", "Messages from clubs, return records and notes for the next shift") +
      '<form class="panel" data-note novalidate aria-label="Handover note">' +
      (ui.form && ui.form.type === "note" ? summary() : "") +
      '<div class="form">' +
      field(
        "Note for the next shift",
        "note",
        '<textarea id="f-note" name="note" rows="2" maxlength="400"' +
          describedBy("note", e.note, "note") +
          ">" +
          esc(v.note || "") +
          "</textarea>",
        e.note,
        "Returns and custody changes are recorded here automatically.",
        "full",
      ) +
      '</div><div class="formactions"><button type="submit">Add handover note</button></div></form>' +
      deskEntries().map(entryHtml).join("")
    );
  }

  const screens = {
    Counter: counterPage,
    Requests: requestPage,
    Inventory: inventory,
    "Loan register": register,
    "Desk book": deskbook,
  };

  /* ---------- Rendering ---------- */

  function focusKey(el) {
    if (!el || el === document.body || !root.contains(el)) return null;
    if (el.id) return "#" + CSS.escape(el.id);
    if (el.dataset && el.dataset.action)
      return (
        '[data-action="' +
        CSS.escape(el.dataset.action) +
        '"][data-val="' +
        CSS.escape(el.dataset.val || "") +
        '"]'
      );
    return null;
  }
  function paint() {
    const keep = ui.focus || focusKey(document.activeElement);
    const explicit = !!ui.focus;
    ui.focus = null;
    const phase = shifts[s.phase];
    q("[data-clock]").textContent = phase.time;
    q("[data-shift-title]").textContent = phase.title;
    q("[data-shift]").textContent = phase.text;
    const advance = q('[data-action="advance"]');
    advance.hidden = !phase.next;
    advance.textContent = phase.next || "";
    const open = s.loans.filter((l) => !l.back).length;
    q("[data-nav]").innerHTML = pages
      .map(
        ([n, ic]) =>
          '<button type="button" data-action="tab" data-val="' +
          n +
          '"' +
          (s.tab === n ? ' aria-current="page"' : "") +
          ">" +
          icon(ic) +
          "<span>" +
          n +
          "</span>" +
          (n === "Counter" && open
            ? '<span class="count"><span class="sr-only">, </span>' +
              open +
              '<span class="sr-only"> open</span></span>'
            : "") +
          "</button>",
      )
      .join("");
    q("[data-page]").innerHTML = screens[s.tab]();
    q("[data-status]").textContent = s.notice;
    const undoBtn = q('[data-action="undo"]');
    undoBtn.hidden = !undo;
    undoBtn.setAttribute("aria-label", undo ? "Undo: " + undo.label : "Undo");
    const el = keep && q(keep);
    if (el) {
      el.focus({ preventScroll: !explicit });
      if (explicit && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
    }
  }
  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(s));
      return true;
    } catch {
      q("[data-status]").textContent =
        s.notice + " Browser storage is unavailable. Progress lasts for this visit.";
      return false;
    }
  }
  function commit(msg) {
    if (msg) s.notice = msg;
    paint();
    save();
  }

  /* ---------- Atomic record changes ---------- */

  class Invalid extends Error {
    constructor(errors) {
      super("Validation failed");
      this.errors = errors;
    }
  }
  const fail = (errors) => {
    if (Object.keys(errors).length) throw new Invalid(errors);
  };
  // Run `change` against a copy of the state. Only a change that passes
  // every rule replaces the live state; anything else leaves it untouched.
  function transact(change, values, focusAfter = "[data-page] h2") {
    const draft = structuredClone(s);
    let msg;
    try {
      msg = change(draft);
    } catch (err) {
      const errors =
        err instanceof Invalid
          ? err.errors
          : { _form: "Something went wrong, so nothing was changed. Try again." };
      if (!(err instanceof Invalid)) console.error(err);
      ui.errors = errors;
      ui.values = values;
      ui.focus = ".errorsummary";
      s.notice = "Nothing was saved. " + (errors._form || "Check the highlighted fields.");
      paint();
      return false;
    }
    undo = {
      loans: structuredClone(s.loans),
      notes: structuredClone(s.notes),
      label: msg,
    };
    s = draft;
    ui = blankUi();
    ui.focus = focusAfter;
    commit(msg);
    return true;
  }

  function tagError(st, l, input) {
    const raw = String(input ?? "").trim();
    const t = normTag(raw);
    if (!t) return "Enter the tag printed on the unit in hand.";
    const a = assets.find((x) => normTag(x.id) === t);
    if (!a) return "No unit has the tag “" + raw + "”. Check the label and try again.";
    if (a.id === l.asset) return "";
    const other = openLoanIn(st, a.id);
    const where = a.repair
      ? a.id + " is recorded in repair."
      : other
        ? a.id + " is on slip L-" + other.num + ". Check it in there instead."
        : a.id + " is recorded on the shelf in bin " + a.bin + ".";
    return (
      "That unit is " +
      a.id +
      " (" +
      a.model +
      "), not " +
      l.asset +
      ". " +
      where +
      " Slip L-" +
      l.num +
      " stays open."
    );
  }

  function issueKit(st, reqId, data) {
    const r = getReq(reqId);
    if (!r) throw new Invalid({ _form: "This request could not be found." });
    const errors = {};
    const who = data.get("collector");
    const due = data.get("due");
    if (!people.includes(who)) errors.collector = "Choose who is collecting the kit.";
    if (!Object.hasOwn(returnTimes, due)) errors.due = "Choose a return-by time.";
    else if (returnTimes[due] <= nowAt(st)) errors.due = "Return-by must be later than the desk time.";
    const picked = [];
    let selected = 0;
    r.items.forEach((type, i) => {
      if (!data.has("take-" + i)) return;
      selected++;
      const key = "unit-" + i;
      const a = getAsset(data.get(key));
      if (!a) errors[key] = "Choose the " + type + " leaving the desk.";
      else if (a.type !== type)
        errors[key] = "This equipment type is outside the approved request. Choose an approved unit.";
      else if (a.repair) errors[key] = a.id + " is in repair and cannot be issued.";
      else if (openLoanIn(st, a.id)) errors[key] = a.id + " is already on loan.";
      else if (st.loans.some((l) => l.req === r.id && !l.back && typeOf(l) === type))
        errors[key] = "The approved quantity of this equipment type is already on loan.";
      else if (picked.some((p) => p.id === a.id)) errors[key] = a.id + " is selected twice.";
      else picked.push(a);
    });
    if (!selected) errors._form = "Select at least one item to issue.";
    fail(errors);
    const nums = picked.map((a) => {
      const num = nextNum(st);
      st.loans.push(slip(num, r.id, a.id, who, due, st.phase));
      return num;
    });
    return "Issued " + picked.map((a) => a.id).join(", ") + " to " + who + " on " + slipRange(nums) + ".";
  }

  function issueSingle(st, data) {
    const [req, asset, who, due] = ["req", "asset", "who", "due"].map((k) => data.get(k));
    const r = getReq(req);
    const unit = getAsset(asset);
    const errors = {};
    if (!r) errors.req = "Choose the approved request.";
    if (!unit) errors.asset = "Choose the unit leaving the desk.";
    else if (unit.repair) errors.asset = unit.id + " is in repair and cannot be issued.";
    else if (openLoanIn(st, unit.id)) errors.asset = unit.id + " is already on loan.";
    else if (r && !r.items.includes(unit.type))
      errors.asset = "This equipment type is outside the approved request. Choose an approved unit.";
    else if (r && st.loans.some((l) => l.req === req && !l.back && typeOf(l) === unit.type))
      errors.asset = "The approved quantity of this equipment type is already on loan.";
    if (!people.includes(who)) errors.who = "Choose who is collecting.";
    if (!Object.hasOwn(returnTimes, due)) errors.due = "Choose a return-by time.";
    else if (returnTimes[due] <= nowAt(st)) errors.due = "Return-by must be later than the desk time.";
    fail(errors);
    const num = nextNum(st);
    st.loans.push(slip(num, req, asset, who, due, st.phase));
    return "Issued " + asset + " to " + who + " on slip L-" + num + ".";
  }

  function recordReturn(st, reqId, data) {
    const r = getReq(reqId);
    const open = st.loans.filter((l) => l.req === reqId && !l.back);
    if (!r || !open.length) throw new Invalid({ _form: "Nothing is out on this request." });
    const errors = {};
    const backs = [];
    const outs = [];
    let anyBack = false;
    for (const l of open) {
      const n = l.num;
      const fate = data.get("fate-" + n);
      if (fate === "back") {
        anyBack = true;
        const err = tagError(st, l, data.get("tag-" + n));
        if (err) errors["tag-" + n] = err;
        else backs.push(l);
      } else if (fate === "out") {
        const h = data.get("holder-" + n);
        const when = data.get("expected-" + n);
        if (!people.includes(h)) errors["holder-" + n] = "Who has " + l.asset + " now?";
        if (!Object.hasOwn(returnTimes, when)) errors["expected-" + n] = "When is " + l.asset + " coming back?";
        else if (returnTimes[when] <= nowAt(st))
          errors["expected-" + n] = "Choose a time after the desk time.";
        if (!errors["holder-" + n] && !errors["expected-" + n]) outs.push({ l, h, when });
      } else errors["fate-" + n] = "Mark " + l.asset + " as back at the counter or still out.";
    }
    const by = data.get("returnedBy");
    if (anyBack && !people.includes(by)) errors.returnedBy = "Who handed the units back?";
    fail(errors);
    for (const l of backs) {
      l.back = true;
      l.returnedBy = by;
      l.returnedPhase = st.phase;
    }
    for (const { l, h, when } of outs) {
      l.holder = h;
      l.expected = when;
    }
    const complete = !st.loans.some((l) => l.req === r.id && !l.back);
    const text = [r.id + " · " + r.club + "."];
    if (backs.length) text.push("Returned by " + by + ", tags confirmed: " + backs.map(describe).join(", ") + ".");
    for (const { l, h, when } of outs)
      text.push(
        "Still out: " + describe(l) + " with " + h + ", expected " + when +
          ". Confirm the tag reads " + l.asset + " before closing L-" + l.num + ".",
      );
    if (complete) text.push(r.id + " is complete.");
    st.notes.push({
      phase: st.phase,
      text: text.join(" "),
      kind: "auto",
      req: r.id,
      slips: open.map((l) => l.num),
    });
    const msg = [];
    if (backs.length) msg.push("Returned " + backs.map((l) => l.asset).join(", ") + ".");
    for (const { l, h, when } of outs) msg.push(l.asset + " still out with " + h + ", expected " + when + ".");
    msg.push(complete ? r.id + " complete." : "Handover recorded in the desk book.");
    return msg.join(" ");
  }

  function checkIn(st, num, data) {
    const l = st.loans.find((x) => x.num === num);
    if (!l || l.back) throw new Invalid({ _form: "This slip is already closed." });
    const errors = {};
    const err = tagError(st, l, data.get("tag"));
    if (err) errors.tag = err;
    const by = data.get("returnedBy");
    if (!people.includes(by)) errors.returnedBy = "Who handed the unit back?";
    fail(errors);
    l.back = true;
    l.returnedBy = by;
    l.returnedPhase = st.phase;
    const r = getReq(l.req);
    const left = st.loans.filter((x) => x.req === l.req && !x.back).length;
    st.notes.push({
      phase: st.phase,
      text:
        "L-" + num + " · " + describe(l) + " returned by " + by + ", tag confirmed. " +
        (left ? r.id + ": " + plural(left, "item") + " still out." : r.id + " is complete."),
      kind: "auto",
      req: r.id,
      slips: [num],
    });
    return (
      l.asset + " checked in from " + by + ". Slip L-" + num + " closed." +
      (left ? "" : " " + r.id + " complete.")
    );
  }

  function addNote(st, data) {
    const text = String(data.get("note") || "").trim();
    if (!text) throw new Invalid({ note: "Write a note before saving." });
    st.notes.push({ phase: st.phase, text: text.slice(0, 400), kind: "note", req: "", slips: [] });
    return "Handover note saved.";
  }

  /* ---------- Events ---------- */

  const openForm = (form, focus) => {
    ui = blankUi();
    ui.form = form;
    ui.focus = focus;
  };
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-action]");
    if (!b || !root.contains(b)) return;
    const v = b.dataset.val;
    switch (b.dataset.action) {
      case "restart":
        s = original();
        ui = blankUi();
        undo = null;
        break;
      case "advance":
        if (s.phase < shifts.length - 1) s.phase++;
        s.notice = "Shift time updated to " + shifts[s.phase].time + ".";
        ui = blankUi();
        undo = null;
        break;
      case "tab":
        s.tab = v;
        ui = blankUi();
        break;
      case "close":
        s.selected = "";
        ui = blankUi();
        ui.focus = "[data-page] h2";
        break;
      case "request":
        s.tab = "Requests";
        s.selected = v;
        ui = blankUi();
        ui.focus = "[data-page] h2";
        break;
      case "kit":
        openForm({ type: "kit", req: v }, "#kit-title");
        break;
      case "return-form":
        openForm({ type: "return", req: v }, "#ret-title");
        break;
      case "checkin":
        openForm({ type: "checkin", num: Number(v) }, "#f-tag");
        break;
      case "new":
        openForm({ type: "slip" }, "#f-req");
        break;
      case "cancel-form":
        ui = blankUi();
        ui.focus = "[data-page] h2";
        break;
      case "scope":
        s.onlyOpen = v === "0";
        break;
      case "undo":
        if (!undo) return;
        s.loans = undo.loans;
        s.notes = undo.notes;
        s.notice = "Undone: " + undo.label;
        undo = null;
        ui = blankUi();
        ui.focus = "[data-page] h2";
        break;
      default:
        return;
    }
    commit();
  });
  root.addEventListener("change", (e) => {
    if (e.target.matches("#f-filter")) {
      s.filter = filters.includes(e.target.value) ? e.target.value : "All items";
      commit();
    }
  });
  root.addEventListener("input", (e) => {
    if (e.target.id !== "lookup") return;
    s.query = e.target.value.slice(0, 80);
    if (ui.form && ui.form.type === "checkin") ui = blankUi();
    q("[data-results]").innerHTML = counterResults();
    q("[data-resultcount]").textContent = resultCount();
    save();
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && ui.form && e.target.closest("form")) {
      ui = blankUi();
      ui.focus = "[data-page] h2";
      paint();
    }
  });
  root.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const data = new FormData(f);
    const values = Object.fromEntries(data);
    if (f.matches("[data-search]")) return;
    if (f.matches("[data-note]")) {
      ui.form = { type: "note" };
      transact((st) => addNote(st, data), values, "#f-note");
      return;
    }
    if (f.matches("[data-issue]")) transact((st) => issueSingle(st, data), values);
    else if (f.matches("[data-kit]")) transact((st) => issueKit(st, f.dataset.req, data), values);
    else if (f.matches("[data-return]")) transact((st) => recordReturn(st, f.dataset.req, data), values);
    else if (f.matches("[data-checkin]")) transact((st) => checkIn(st, Number(f.dataset.num), data), values);
  });

  /* ---------- Persistence ---------- */

  const isPhase = (p) => Number.isInteger(p) && p >= 0 && p < shifts.length;
  const optPerson = (p) => p === "" || people.includes(p);
  const optTime = (t) => t === "" || Object.hasOwn(returnTimes, t);
  function migrate(d) {
    if (!d || typeof d !== "object" || d.version !== 1) return d;
    return {
      ...d,
      version: 2,
      query: "",
      onlyOpen: typeof d.onlyOpen === "boolean" ? d.onlyOpen : true,
      selected: d.selected || "",
      loans: Array.isArray(d.loans)
        ? d.loans.map((l) =>
            l && typeof l === "object"
              ? { holder: "", expected: "", returnedBy: "", issuedPhase: null, returnedPhase: null, ...l }
              : l,
          )
        : d.loans,
      notes: Array.isArray(d.notes)
        ? d.notes.map((n) => (n && typeof n === "object" ? { kind: "note", req: "", slips: [], ...n } : n))
        : d.notes,
    };
  }
  function valid(d) {
    if (!d || typeof d !== "object" || d.version !== 2) return false;
    if (!Object.hasOwn(screens, d.tab) || !isPhase(d.phase)) return false;
    if (typeof d.selected !== "string" || (d.selected && !getReq(d.selected))) return false;
    if (!filters.includes(d.filter) || typeof d.onlyOpen !== "boolean" || typeof d.query !== "string")
      return false;
    if (!Array.isArray(d.loans) || !d.loans.length || !Array.isArray(d.notes)) return false;
    const nums = new Set();
    const openAssets = new Set();
    for (const l of d.loans) {
      if (
        !l ||
        typeof l !== "object" ||
        !Number.isInteger(l.num) ||
        nums.has(l.num) ||
        !getReq(l.req) ||
        !getAsset(l.asset) ||
        !people.includes(l.who) ||
        !Object.hasOwn(returnTimes, l.due) ||
        typeof l.back !== "boolean" ||
        !optPerson(l.holder) ||
        !optTime(l.expected) ||
        !optPerson(l.returnedBy) ||
        !(l.issuedPhase === null || isPhase(l.issuedPhase)) ||
        !(l.returnedPhase === null || isPhase(l.returnedPhase))
      )
        return false;
      nums.add(l.num);
      if (!l.back) {
        if (openAssets.has(l.asset)) return false;
        openAssets.add(l.asset);
      }
    }
    return d.notes.every(
      (n) =>
        n &&
        isPhase(n.phase) &&
        typeof n.text === "string" &&
        n.text.length <= 2000 &&
        (n.kind === "note" || n.kind === "auto") &&
        (n.req === "" || !!getReq(n.req)) &&
        Array.isArray(n.slips) &&
        n.slips.every((x) => nums.has(x)),
    );
  }
  function load() {
    let raw = null;
    let legacy = false;
    try {
      raw = localStorage.getItem(storageKey);
      if (!raw) {
        raw = localStorage.getItem(legacyKey);
        legacy = !!raw;
      }
    } catch {
      return;
    }
    if (!raw) return;
    let d;
    try {
      d = migrate(JSON.parse(raw));
    } catch {
      d = null;
    }
    if (!valid(d)) {
      s.notice = "The saved shift could not be read, so the sample shift was restored.";
      return;
    }
    const base = original();
    s = {
      ...base,
      tab: d.tab,
      phase: d.phase,
      selected: d.selected,
      filter: d.filter,
      onlyOpen: d.onlyOpen,
      query: d.query.slice(0, 80),
      loans: d.loans.map((l) => ({
        num: l.num,
        req: l.req,
        asset: l.asset,
        who: l.who,
        due: l.due,
        back: l.back,
        holder: l.holder,
        expected: l.expected,
        issuedPhase: l.issuedPhase,
        returnedBy: l.returnedBy,
        returnedPhase: l.returnedPhase,
      })),
      notes: d.notes.map((n) => ({ phase: n.phase, text: n.text, kind: n.kind, req: n.req, slips: [...n.slips] })),
      notice: typeof d.notice === "string" ? d.notice : base.notice,
    };
    if (legacy) {
      s.notice = "Your earlier shift was carried over to the updated desk records.";
      save();
    }
  }

  load();
  paint();
})();
