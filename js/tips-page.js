"use strict";

var app = document.getElementById("app");

/* Held in memory only, for as long as this tab stays on the page — a reload
   asks again. Same trade as the share dashboard: club laptops get shared. */
var password = null;

var state = { liveId: null, articles: [] };
var dirty = false;

function el(tag, attrs) {
  var n = document.createElement(tag);
  attrs = attrs || {};
  for (var k in attrs) {
    if (attrs[k] == null || attrs[k] === false) continue;
    if (k === "class") n.className = attrs[k];
    else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
    else n.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
  }
  for (var i = 2; i < arguments.length; i++) {
    var c = arguments[i];
    if (c == null || c === false) continue;
    if (Array.isArray(c)) { for (var j = 0; j < c.length; j++) if (c[j] != null) n.append(c[j]); }
    else n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}

function post(payload) {
  return fetch("/api/tips-admin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  }).then(function (res) {
    if (res.status === 401) throw new Error("That password is not right.");
    if (res.status === 503) {
      throw new Error(
        "No password is set on the site yet, so the editor stays locked. Set " +
        "TIPS_PASSWORD (or ADMIN_PASSWORD) on the Pages project — see the README."
      );
    }
    if (!res.ok) throw new Error("The server answered " + res.status + ". Try again in a moment.");
    return res.json();
  });
}

/* ---------- login --------------------------------------------------------- */

function renderLogin(message) {
  app.textContent = "";
  var input = el("input", {
    type: "password",
    autocomplete: "current-password",
    placeholder: "Password",
    onkeydown: function (e) { if (e.key === "Enter") go(); }
  });
  var btn = el("button", { class: "btn primary", onclick: function () { go(); } }, "Open the editor");

  function go() {
    if (!input.value) return;
    btn.disabled = true;
    post({ password: input.value })
      .then(function (data) {
        password = input.value;
        state = { liveId: data.liveId || null, articles: data.articles || [] };
        dirty = false;
        render(data.warning === "no-store" ? "warn-no-store" : null);
      })
      ["catch"](function (e) {
        renderLogin(e.message);
        var next = app.querySelector("input");
        if (next) next.focus();
      });
  }

  app.append(
    el("div", { class: "card" },
      el("div", { class: "row" },
        el("div", {}, el("label", {}, "Coach password"), input),
        el("div", { style: "flex:0 0 auto" }, btn)
      ),
      message ? el("p", { class: "err" }, message) : null
    )
  );
  input.focus();
}

/* ---------- the preview ---------------------------------------------------
   Built from the same rules the athlete's cloud uses, loaded from
   js/tipfmt.js so the preview can never disagree with what they will see.
   ------------------------------------------------------------------------- */

/** Runs into text nodes and <b>, and nothing else. */
function runs(text) {
  return tipRuns(text).map(function (r) {
    return r.bold ? el("b", {}, r.text) : document.createTextNode(r.text);
  });
}

/** The byline athletes see under every article. */
function signatureNode(lang) {
  var ic = el("span", { class: "sign-ic" });
  ic.innerHTML = TIP_SIGN.icon;
  var a = el("a", {
    class: "sign",
    href: TIP_SIGN.url,
    target: "_blank",
    rel: "noopener noreferrer"
  }, ic, el("span", {}, tipSignName(lang)));
  return el("div", { class: "sign-wrap" }, a);
}

function previewNodes(body) {
  return tipBlocks(body).map(function (b) {
    if (b.kind === "ul") {
      var ul = el("ul", {});
      b.items.forEach(function (t) { ul.append(el("li", {}, runs(t))); });
      return ul;
    }
    return el("p", {}, runs(b.text));
  });
}

/* ---------- when it was written ------------------------------------------
   No locale is passed, so these follow the coach's own browser rather than
   the page's English chrome.
   ------------------------------------------------------------------------- */

function stamp(iso) {
  if (!iso) return null;
  var d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

function articleTimes(a) {
  // Articles saved before `created` existed carry only their last edit,
  // which is the closest thing to a posting date they have.
  var posted = stamp(a.created || a.updated);
  if (!posted) return el("div", { class: "times" }, "Not saved yet");

  var line = el("div", { class: "times" }, "Posted " + posted);
  // Only worth saying when it differs from the posting; a fresh article
  // would otherwise carry the same date twice.
  if (a.created && a.updated && a.updated !== a.created) {
    var edited = stamp(a.updated);
    if (edited) line.append(" \u00b7 Updated " + edited);
  }
  return line;
}

/* ---------- the editor ----------------------------------------------------- */

function field(labelText, node, hint) {
  return el("div", { class: "f" }, el("label", {}, labelText), node,
    hint ? el("p", { class: "hint" }, hint) : null);
}

function sideEditor(article, lang, onChange) {
  var side = article[lang] = article[lang] || { title: "", body: "" };
  var isAr = lang === "ar";

  var title = el("input", {
    type: "text",
    maxlength: "140",
    placeholder: isAr ? "عنوان المقال" : "Why the last rep is the one that counts",
    value: side.title || "",
    oninput: function () { side.title = title.value; onChange(); }
  });

  var body = el("textarea", {
    maxlength: "9000",
    placeholder: isAr
      ? "اكتبي المقال هنا…"
      : "Write it the way you would say it.\n\nLeave a blank line between paragraphs.\n\n- start a line with a dash for a bullet\n- and another",
    oninput: function () { side.body = body.value; onChange(); }
  });
  body.value = side.body || "";

  var preview = el("div", { class: "prev" + (isAr ? " ar" : "") });
  if (isAr) preview.setAttribute("dir", "rtl");

  function drawPreview() {
    var lang = isAr ? "ar" : "en";
    preview.textContent = "";
    preview.append(el("div", { class: "cap" }, isAr ? "معاينة" : "Preview"));
    if (article.photo) preview.append(el("img", { class: "tip-photo", src: article.photo, alt: "" }));
    if (side.title) preview.append(el("h3", {}, side.title));
    var nodes = previewNodes(side.body);
    if (!nodes.length && !side.title) {
      preview.append(el("p", { class: "muted" },
        isAr ? "لا شيء بعد." : "Nothing here yet."));
    }
    nodes.forEach(function (n) { preview.append(n); });
    // Athletes always see the byline, so the preview shows it too.
    preview.append(signatureNode(lang));
  }

  var box = el("div", { class: "side" + (isAr ? " ar" : "") },
    field(isAr ? "العنوان" : "Title", title),
    field(isAr ? "المقال" : "Article", body,
      isAr ? null : "Blank line = new paragraph. A line starting with - is a bullet. **Stars** make a phrase bold."),
    preview
  );

  drawPreview();
  title.addEventListener("input", drawPreview);
  body.addEventListener("input", drawPreview);
  return box;
}

/* One photo for the article, the same in both languages, and optional: most
   tips are words. Uploaded the moment it is picked (js/shrink.js, then
   action "upload"), and kept only once the article is saved with it. */
function photoField(article) {
  var msg = el("span", { class: "muted small" });
  var file = el("input", { type: "file", accept: "image/*" });
  file.addEventListener("change", function () {
    var f = file.files && file.files[0];
    if (!f) return;
    msg.textContent = "Uploading the photo…";
    shrinkPhoto(f)
      .then(function (data) { return post({ password: password, action: "upload", data: data }); })
      .then(function (d) { article.photo = d.url; touch(); render(); })
      ["catch"](function (e) { msg.textContent = e.message; })
      .then(function () { file.value = ""; });
  });
  return el("div", { class: "f", style: "margin-bottom:14px" },
    el("label", {}, "Photo (optional)"),
    el("div", { class: "head", style: "margin-bottom:0" },
      el("label", { class: "btn sm pick" }, article.photo ? "Replace photo" : "Add a photo", file),
      article.photo ? el("button", { class: "btn sm danger", type: "button",
        onclick: function () { article.photo = ""; touch(); render(); } }, "Remove photo") : null,
      msg),
    el("p", { class: "hint" }, "Shown above the article, in both languages."));
}

/* ---------- the list ------------------------------------------------------
   One line an article -- its title, Live and In news, when it went up -- and
   the editor only for the one that is open. Every article open at once, both
   languages side by side, was a page of text boxes nobody could find their
   way down. */

var openId = null;     // the article whose editor is showing
var openLang = "en";   // which language its editor is on

function titleOf(a) {
  return (a.en && a.en.title) || (a.ar && a.ar.title) || "Untitled article";
}

function articleLine(article, index) {
  var isLive = state.liveId === article.id;
  var open = openId === article.id;

  /* The feed is a list, not a slot: any number of articles can be on it.
     Separate from live, which is the one the logo beside the session opens. */
  var inFeed = el("input", { type: "checkbox", role: "switch", checked: !!article.feed, "aria-label": "In the news feed",
    onchange: function () { article.feed = inFeed.checked; touch(); render(); } });

  var what = el("div", { class: "t-what", role: "button", tabindex: "0", "aria-expanded": open ? "true" : "false" },
    el("b", { dir: "auto" }, titleOf(article)),
    articleTimes(article));
  var flip = function () { openId = open ? null : article.id; render(); };
  what.addEventListener("click", flip);
  what.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } });

  var line = el("div", { class: "t-row" + (isLive ? " live" : "") + (open ? " open" : "") },
    what,
    el("div", { class: "t-side" },
      isLive ? el("span", { class: "badge" }, "Live")
        : el("button", { class: "btn sm", type: "button", onclick: function () { state.liveId = article.id; touch(); render(); } }, "Make live"),
      el("label", { class: "tgl", title: "In the news feed" }, el("span", {}, "News"), inFeed)));

  if (!open) return line;

  /* The open one: a photo, the two languages as tabs, and the preview under
     whichever is showing. */
  var tabs = el("div", { class: "t-tabs", role: "tablist" },
    [["en", "English"], ["ar", "العربية"]].map(function (l) {
      return el("button", { type: "button", role: "tab", "aria-selected": openLang === l[0] ? "true" : "false",
        onclick: function () { openLang = l[0]; render(); } }, l[1]);
    }));
  var editor = el("div", { class: "card t-editor" },
    photoField(article),
    tabs,
    sideEditor(article, openLang, touch),
    el("div", { class: "head", style: "margin:14px 0 0" },
      el("button", { class: "btn sm danger", type: "button", onclick: function () {
        if (!confirm("Delete “" + titleOf(article) + "”? This cannot be undone once you save.")) return;
        state.articles.splice(index, 1);
        if (state.liveId === article.id) state.liveId = null;
        openId = null;
        touch();
        render();
      } }, "Delete this article")));
  return el("div", {}, line, editor);
}

function touch() {
  if (dirty) return;
  dirty = true;
  var msg = document.getElementById("savemsg");
  if (msg) { msg.className = "msg muted"; msg.textContent = "Unsaved changes."; }
}

function newId() {
  return "a" + Math.random().toString(36).slice(2, 10);
}

function render(warning) {
  app.textContent = "";

  if (warning === "warn-no-store") {
    app.append(el("div", { class: "card" },
      el("h2", {}, "Nothing can be saved yet"),
      el("p", { class: "muted small", style: "margin:8px 0 0" },
        "The password is right, but no KV namespace is bound to the site, so " +
        "there is nowhere to keep articles. Bind one called STATS — see the README.")
    ));
    return;
  }

  if (!state.articles.length) {
    app.append(el("div", { class: "card" },
      el("h2", {}, "No articles yet"),
      el("p", { class: "muted small", style: "margin:8px 0 14px" },
        "Write one and mark it live. Until something is live, the logo button " +
        "stays off the session page entirely — athletes never see an empty pop-up."),
      el("button", { class: "btn primary", onclick: addOne }, "Write the first one")
    ));
    app.append(saveBar());
    return;
  }

  app.append(el("div", { class: "t-top" },
    el("button", { class: "btn primary", onclick: addOne }, "+ New article"),
    el("span", { class: "muted small" }, state.articles.length + (state.articles.length === 1 ? " article" : " articles"))));
  var list = el("div", { class: "t-list" });
  state.articles.forEach(function (a, i) { list.append(articleLine(a, i)); });
  app.append(list);

  if (!state.liveId) {
    app.append(el("p", { class: "err" },
      "Nothing is marked live, so the logo button is hidden on the session page."));
  }

  app.append(saveBar());
}

function addOne() {
  // Newest first, the way the feed reads it.
  var a = { id: newId(), feed: true, en: { title: "", body: "" }, ar: { title: "", body: "" } };
  state.articles.unshift(a);
  if (!state.liveId) state.liveId = a.id; // the first one written is the one they want live
  openId = a.id;
  openLang = "en";
  touch();
  render();
  // Straight into the new one rather than making her hunt for it.
  var card = app.querySelector(".t-editor");
  var first = card && card.querySelector("input[type=text]");
  if (first) { first.focus(); card.scrollIntoView({ block: "center", behavior: "smooth" }); }
}

function saveBar() {
  var msg = el("div", { class: "msg muted", id: "savemsg" },
    dirty ? "Unsaved changes." : "Everything is saved.");

  var save = el("button", { class: "btn primary", onclick: function () {
    save.disabled = true;
    msg.className = "msg muted";
    msg.textContent = "Saving…";
    post({ password: password, save: { liveId: state.liveId, articles: state.articles } })
      .then(function (data) {
        // Take the server's copy back: it has trimmed the text and settled the
        // ids, so what is on screen is exactly what athletes will be served.
        state = { liveId: data.liveId || null, articles: data.articles || [] };
        dirty = false;
        render();
        var m = document.getElementById("savemsg");
        if (m) { m.className = "msg ok"; m.textContent = "Saved. Athletes see it on their next open."; }
      })
      ["catch"](function (e) {
        save.disabled = false;
        msg.className = "msg err";
        msg.textContent = e.message;
      });
  } }, "Save");

  return el("div", { class: "bar" },
    el("div", { class: "in" },
      msg,
      el("button", { class: "btn", onclick: function () {
        if (dirty && !confirm("Leave without saving? Your changes are lost.")) return;
        password = null; state = { liveId: null, articles: [] }; dirty = false;
        renderLogin(null);
      } }, "Lock"),
      save
    ));
}

window.addEventListener("beforeunload", function (e) {
  if (!dirty) return;
  e.preventDefault();
  e.returnValue = "";
});

/* A coach or admin who is logged in -- tapped through from /admin or the
   app -- is let straight in by the Worker (isStaff in routes/tips.js), so try
   that before asking for a password. */
post({}).then(function (data) {
  state = { liveId: data.liveId || null, articles: data.articles || [] };
  dirty = false;
  render(data.warning === "no-store" ? "warn-no-store" : null);
})["catch"](function () { renderLogin(null); });
