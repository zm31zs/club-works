/* 前台展示逻辑：首页姓名列表 + 作品列表页 */
(function (global) {
  'use strict';
  var C = global.SITE_CONFIG || {};

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  function safeUrl(u) {
    u = String(u || '').trim();
    return /^https?:\/\//i.test(u) ? u : '';
  }

  // 灯箱
  function initLightbox() {
    var box = document.getElementById('lightbox');
    if (!box) return;
    var img = box.querySelector('img');
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-zoom]');
      if (t) {
        var src = t.getAttribute('data-zoom');
        if (src) { img.src = src; box.classList.add('show'); }
      }
    });
    box.addEventListener('click', function () { box.classList.remove('show'); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') box.classList.remove('show');
    });
  }

  function showError(msg) {
    var el = document.getElementById('error');
    if (el) { el.style.display = 'block'; el.textContent = msg; }
  }

  // 标题优先取数据文件里的 meta（后台可改），没有再回退到 config.js
  function applySiteMeta(meta) {
    var m = meta || {};
    var t = String(m.title || C.siteTitle || '').trim();
    var s = String(m.subtitle || C.siteSubtitle || '').trim();
    window.__cwMeta = { title: t, subtitle: s };
    if (t) document.title = t;
    var h = document.getElementById('site-title');
    var sub = document.getElementById('site-subtitle');
    if (h && t) h.textContent = t;
    if (sub && s) sub.textContent = s;
    var names = document.querySelectorAll('[data-site-name]');
    for (var i = 0; i < names.length; i++) {
      if (t) names[i].textContent = t + (names[i].getAttribute('data-site-name') || '');
    }
  }
  function setTitle() { applySiteMeta(null); }

  // 首页：姓名网格
  function renderHome(data) {
    var list = (data.students || []).filter(function (s) { return s.visible !== false; });
    list.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });

    var kw = (document.getElementById('search').value || '').trim().toLowerCase();
    var box = document.getElementById('grid');
    if (kw) list = list.filter(function (s) { return String(s.name).toLowerCase().indexOf(kw) >= 0; });

    if (!list.length) {
      box.innerHTML = '<div class="empty"><div class="big">○</div>' +
        (kw ? '没有找到匹配的姓名' : '还没有学生，请到后台添加') + '</div>';
      return;
    }
    box.innerHTML = list.map(function (s) {
      var works = (s.works || []).filter(function (w) { return w.visible !== false; });
      var initial = String(s.name || '?').charAt(0);
      return '<a class="name-card" href="student.html?id=' + encodeURIComponent(s.id) + '">' +
        '<div class="avatar">' + esc(initial) + '</div>' +
        '<div class="nm">' + esc(s.name) + '</div>' +
        '<div class="cnt">' + works.length + ' 件作品</div></a>';
    }).join('');
  }

  // 作品列表页
  function renderStudent(data) {
    var id = new URLSearchParams(location.search).get('id') || '';
    var s = (data.students || []).filter(function (x) { return x.id === id; })[0];
    var nameEl = document.getElementById('student-name');
    var box = document.getElementById('work-grid');

    if (!s) { showError('找不到该学生，请从首页重新进入。'); if (nameEl) nameEl.textContent = '未找到'; return; }
    if (nameEl) nameEl.textContent = s.name;
    var siteTitle = (window.__cwMeta && window.__cwMeta.title) || C.siteTitle || '作品展';
    document.title = s.name + ' 的作品 - ' + siteTitle;

    var works = (s.works || []).filter(function (w) { return w.visible !== false; });
    works.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });

    if (!works.length) {
      box.innerHTML = '<div class="empty"><div class="big">○</div>该同学还没有上架作品</div>';
      return;
    }
    box.innerHTML = works.map(function (w) {
      var img = String(w.image || '');
      var cover = /^https?:\/\//i.test(img)
        ? '<img class="work-cover" data-zoom="' + esc(img) + '" src="' + esc(img) + '" alt="' + esc(w.title) + '">'
        : (img
            ? '<img class="work-cover" data-zoom="' + esc(img) + '" src="' + esc(img) + '" alt="' + esc(w.title) + '">'
            : '<div class="work-cover-placeholder" data-zoom="">作品图片待上传</div>');
      var link = safeUrl(w.link);
      var btn = link
        ? '<a class="work-link" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">查看作品 →</a>'
        : '<span class="work-link disabled">暂无链接</span>';
      var social = '';
      if (global.CWSocial && global.CWSocial.configured()) {
        social = '<div class="social" data-work="' + esc(w.id) + '" data-student="' + esc(s.id) + '">' +
          '<button class="like-btn" type="button" aria-label="点赞"><span class="like-ico">♡</span> <span class="like-num">0</span></button>' +
          '<div class="cmt-box">' +
            '<div class="cmt-head">留言 <span class="cmt-num">0</span></div>' +
            '<div class="cmt-list"><div class="cmt-empty">暂无留言，来说两句吧</div></div>' +
            '<div class="cmt-form">' +
              '<input class="cmt-nick" maxlength="20" placeholder="你的昵称（选填）">' +
              '<textarea class="cmt-text" maxlength="300" placeholder="写下你的留言…"></textarea>' +
              '<button class="cmt-send btn" type="button">发表留言</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      }
      return '<article class="work-card">' + cover +
        '<div class="work-body"><h3 class="work-title">' + esc(w.title) + '</h3>' +
        (w.desc ? '<p class="work-desc">' + esc(w.desc) + '</p>' : '<p class="work-desc"></p>') +
        btn + social + '</div></article>';
    }).join('');
    if (global.CWSocial && global.CWSocial.configured()) loadSocial();
  }

  // 载入互动数据并绑定事件
  function loadSocial() {
    var S = global.CWSocial;
    S.loadAll(function (err, all) {
      if (err) { setSocialHint('互动数据加载失败：' + err.message); return; }
      var st = S.stats(all);
      var boxes = document.querySelectorAll('.social[data-work]');
      for (var i = 0; i < boxes.length; i++) bindSocialBox(boxes[i], st, all.comments || []);
    });
  }

  function setSocialHint(msg) {
    var box = document.querySelector('.social');
    if (!box) return;
    var h = document.createElement('div');
    h.className = 'social-hint'; h.textContent = msg;
    box.appendChild(h);
  }

  function bindSocialBox(box, st, comments) {
    var workId = box.getAttribute('data-work');
    var studentId = box.getAttribute('data-student') || '';
    var numEl = box.querySelector('.like-num');
    var icoEl = box.querySelector('.like-ico');
    var likeBtn = box.querySelector('.like-btn');
    var info = st[workId] || { likes: 0, comments: 0, liked: false };
    numEl.textContent = info.likes;
    icoEl.textContent = info.liked ? '♥' : '♡';
    likeBtn.classList.toggle('liked', !!info.liked);

    var listEl = box.querySelector('.cmt-list');
    var numC = box.querySelector('.cmt-num');
    var mine = comments.filter(function (c) { return c.workId === workId; });
    renderComments(listEl, mine);
    numC.textContent = mine.length;

    likeBtn.onclick = function () {
      likeBtn.disabled = true;
      global.CWSocial.toggleLike(workId, studentId, function (err, liked) {
        likeBtn.disabled = false;
        if (err) { alert('点赞失败：' + err.message); return; }
        info.likes += liked ? 1 : -1;
        if (info.likes < 0) info.likes = 0;
        info.liked = liked;
        numEl.textContent = info.likes;
        icoEl.textContent = liked ? '♥' : '♡';
        likeBtn.classList.toggle('liked', !!liked);
      });
    };

    var sendBtn = box.querySelector('.cmt-send');
    sendBtn.onclick = function () {
      var nickEl = box.querySelector('.cmt-nick');
      var textEl = box.querySelector('.cmt-text');
      var text = (textEl.value || '').trim();
      if (!text) { textEl.focus(); return; }
      sendBtn.disabled = true;
      global.CWSocial.addComment(workId, studentId, (nickEl.value || '').trim(), text, function (err) {
        sendBtn.disabled = false;
        if (err) { alert('留言失败：' + err.message); return; }
        textEl.value = '';
        mine.push({ workId: workId, nickname: (nickEl.value || '').trim() || '同学', content: text, createdAt: Date.now() });
        renderComments(listEl, mine);
        numC.textContent = mine.length;
      });
    };
  }

  function renderComments(listEl, rows) {
    if (!rows || !rows.length) {
      listEl.innerHTML = '<div class="cmt-empty">暂无留言，来说两句吧</div>';
      return;
    }
    var S = global.CWSocial;
    listEl.innerHTML = rows.map(function (c) {
      var nick = S.esc((c.nickname || '同学').slice(0, 20));
      var text = S.esc(c.content || '');
      var time = S.timeText(c.createdAt);
      return '<div class="cmt-item"><div class="cmt-meta"><b>' + nick + '</b>' +
        (time ? '<span>' + S.esc(time) + '</span>' : '') + '</div>' +
        '<div class="cmt-content">' + text + '</div></div>';
    }).join('');
  }

  function init() {
    setTitle();
    initLightbox();
    var searchEl = document.getElementById('search');
    if (searchEl) {
      searchEl.addEventListener('input', function () {
        if (window.__cwData) renderHome(window.__cwData);
      });
    }
    global.CWStore.loadPublic(function (err, data) {
      if (err) { showError('数据加载失败：' + err.message + '。请确认仓库已开启 GitHub Pages，且 data/content.json 已上传。'); return; }
      window.__cwData = data;
      applySiteMeta(data && data.meta);
      if (document.getElementById('grid')) renderHome(data);
      if (document.getElementById('work-grid')) renderStudent(data);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
