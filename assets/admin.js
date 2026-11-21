/* 后台管理逻辑：登录、学生/作品增删改、图片上传、保存提交 */
(function (global) {
  'use strict';
  var C = global.SITE_CONFIG || {};
  var S = global.CWStore;
  var state = { data: null, sha: null, selected: null, dirty: false };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  function uid(p) { return p + '_' + Date.now().toString(36) + Math.floor(Math.random() * 1000); }
  // 全局浮动提示：无论页面滚到哪里都能看到操作结果
  function toast(msg, type) {
    if (!msg) return;
    var wrap = $('cw-toast-wrap');
    if (!wrap) return;
    var icon = type === 'err' ? '✕' : (type === 'ok' ? '✓' : '');
    var el = document.createElement('div');
    el.className = 'toast ' + (type || 'info');
    el.innerHTML = (icon ? '<span class="ic">' + icon + '</span>' : '') + '<span>' + esc(msg) + '</span>';
    wrap.appendChild(el);
    setTimeout(function () {
      el.className += ' out';
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 240);
    }, type === 'err' ? 5200 : 3000);
  }

  // 记住最近一次点击的按钮，用于给按钮自身加反馈
  var lastClickedBtn = null;

  // 顶部状态栏 + 浮动提示 + 按钮反馈同时更新
  function status(msg, isErr) {
    var cls = 'status' + (isErr ? ' err' : '');
    var a = $('status'); if (a) { a.textContent = msg || ''; a.className = cls; }
    var b = $('login-status'); if (b) { b.textContent = msg || ''; b.className = cls; }
    var busy = /^正在/.test(msg || '');
    toast(msg, isErr ? 'err' : (busy ? 'info' : 'ok'));
    if (lastClickedBtn && !lastClickedBtn.disabled) {
      flashBtn(lastClickedBtn, isErr ? 'err' : (busy ? 'busy' : 'ok'));
      lastClickedBtn = null;
    }
  }

  // 按钮点击反馈：给按钮本身加成功/失败/处理中的视觉状态
  function flashBtn(btn, kind) {
    if (!btn) return;
    var cls = kind === 'err' ? 'btn-fail' : (kind === 'busy' ? 'btn-busy' : 'btn-ok');
    btn.classList.remove('btn-ok');
    btn.classList.remove('btn-fail');
    btn.classList.remove('btn-busy');
    // 强制回流，保证连续点击时动画能重播
    void btn.offsetWidth;
    btn.classList.add(cls);
  }
  function clearFlash(btn) {
    if (!btn) return;
    btn.classList.remove('btn-ok');
    btn.classList.remove('btn-fail');
    btn.classList.remove('btn-busy');
  }

  // 有未发布到网站的数据修改时，让顶部按钮显眼
  function markDirty(on) {
    state.dirty = !!on;
    var btn = $('btn-save');
    if (!btn) return;
    if (on) { btn.classList.add('has-dirty'); btn.textContent = '保存并发布 · 有未发布修改'; }
    else { btn.classList.remove('has-dirty'); btn.textContent = '保存并发布'; }
  }
  function blankData() { return { meta: { title: C.siteTitle || '作品展' }, students: [] }; }

  // 自定义对话框：type='prompt' 带输入框；type='confirm' 只有文字
  function dialog(opts, cb) {
    var mask = $('cw-modal'), title = $('cw-modal-title'), msg = $('cw-modal-msg');
    var label = $('cw-modal-label'), input = $('cw-modal-input');
    var ok = $('cw-modal-ok'), cancel = $('cw-modal-cancel');
    title.textContent = opts.title || '提示';
    if (opts.message) { msg.textContent = opts.message; msg.style.display = ''; }
    else { msg.style.display = 'none'; }
    var isPrompt = opts.type === 'prompt';
    if (isPrompt) {
      label.textContent = opts.label || ''; label.style.display = '';
      input.style.display = ''; input.value = opts.value || ''; input.placeholder = opts.placeholder || '';
    } else {
      label.style.display = 'none'; input.style.display = 'none';
    }
    ok.textContent = opts.okText || '确定';
    mask.style.display = 'flex';
    setTimeout(function () { isPrompt ? input.focus() : ok.focus(); }, 30);

    function done(val) {
      mask.style.display = 'none';
      ok.onclick = cancel.onclick = input.onkeydown = mask.onclick = null;
      if (val !== null && cb) cb(val);
    }
    ok.onclick = function () { done(isPrompt ? input.value : true); };
    cancel.onclick = function () { done(null); };
    input.onkeydown = function (e) { if (e.key === 'Enter') done(input.value); if (e.key === 'Escape') done(null); };
    mask.onclick = function (e) { if (e.target === mask) done(null); };
  }
  function askText(opts, cb) { opts.type = 'prompt'; dialog(opts, cb); }
  function askConfirm(opts, cb) { opts.type = 'confirm'; dialog(opts, cb); }

  // 登录
  function doLogin() {
    var owner = $('in-owner').value.trim();
    var repo = $('in-repo').value.trim();
    var branch = $('in-branch').value.trim() || C.defaultBranch || 'main';
    var token = $('in-token').value.trim();
    if (!owner || !repo || !token) { status('请填写用户名、仓库名和令牌', true); return; }
    S.saveAuth(owner, repo, branch, token);
    status('正在连接 GitHub…');
    loadData();
  }

  // 读取数据
  function loadData() {
    S.readFile('data/content.json', function (err, res) {
      if (err) {
        status('连接失败：' + err.message + '。请检查用户名/仓库名/令牌是否正确。', true);
        return;
      }
      if (!res.content) {
        state.data = blankData(); state.sha = null;
        status('仓库 ' + S.getOwner() + '/' + S.getRepo() + ' 的 ' + S.getBranch() + ' 分支下未找到 data/content.json（将新建）。若你有已发布作品，请确认分支填的是 main。', true);
      } else {
        try { state.data = JSON.parse(res.content); }
        catch (e) { status('数据文件格式错误：' + e.message, true); return; }
        state.sha = res.sha;
      }
      state.data.students = state.data.students || [];
      if (!state.data.students.length) {
        state.selected = null;
      } else {
        state.selected = state.data.students[0].id;
      }
      showApp();
      status('已连接到 ' + S.getOwner() + '/' + S.getRepo());
    });
  }

  function showApp() {
    $('login-panel').style.display = 'none';
    $('app-panel').style.display = 'block';
    var ci = $('conn-info');
    if (ci) ci.textContent = '已连接 ' + S.getOwner() + '/' + S.getRepo() + ' @ ' + S.getBranch();
    markDirty(false);
    // 填充网站标题设置
    var meta = state.data.meta || {};
    var stEl = $('set-title'), sbEl = $('set-subtitle');
    if (stEl) stEl.value = meta.title || C.siteTitle || '';
    if (sbEl) sbEl.value = meta.subtitle || C.siteSubtitle || '';
    renderStudents();
    renderWorks();
  }
  function showLogin() {
    $('login-panel').style.display = 'block';
    $('app-panel').style.display = 'none';
  }

  // 学生列表
  function renderStudents() {
    var box = $('student-list');
    var list = state.data.students.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    var cnt = $('list-count'); if (cnt) cnt.textContent = list.length + ' 位';
    var acts = $('student-actions'); if (acts) acts.style.display = state.selected ? 'flex' : 'none';
    if (!list.length) {
      box.innerHTML = '<div class="mini empty-hint">还没有学生，点下方「新增学生」</div>';
      return;
    }
    box.innerHTML = list.map(function (s, i) {
      var all = (s.works || []).length;
      var on = (s.works || []).filter(function (w) { return w.visible !== false; }).length;
      var initial = String(s.name || '?').charAt(0);
      return '<div class="stu-item ' + (s.id === state.selected ? 'active ' : '') + (s.visible === false ? 'hidden-item' : '') + '" data-sid="' + esc(s.id) + '">' +
        '<div class="stu-avatar">' + esc(initial) + '</div>' +
        '<div class="stu-info"><div class="stu-name">' + esc(s.name) + (s.visible === false ? '<span class="tag tag-off">已下架</span>' : '') + '</div>' +
        '<div class="stu-sub">' + on + ' 件上架' + (all !== on ? ' · 共 ' + all + ' 件' : '') + '</div></div>' +
        '<div class="stu-sort">' +
        '<button class="btn btn-sm" data-act="up" data-sid="' + esc(s.id) + '" title="上移">↑</button>' +
        '<button class="btn btn-sm" data-act="down" data-sid="' + esc(s.id) + '" title="下移">↓</button>' +
        '</div></div>';
    }).join('');
  }

  // 作品列表（右侧）；skipForm=true 时只刷新列表、不重建下方编辑表单
  function renderWorks(skipForm) {
    var box = $('work-list');
    var s = getSelected();
    var cnt = $('work-count');
    if (!s) {
      box.innerHTML = '<div class="mini empty-hint">请在左侧选择或新增学生</div>';
      $('edit-area').innerHTML = '';
      $('work-student-name').textContent = '—';
      if (cnt) cnt.textContent = '';
      return;
    }
    $('work-student-name').textContent = s.name;
    var list = (s.works || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    if (cnt) cnt.textContent = list.length + ' 件';
    if (!list.length) { box.innerHTML = '<div class="mini empty-hint">该学生还没有作品，点上方「新增作品」</div>'; }
    else {
      var cur = $('cur-wid') ? $('cur-wid').value : '';
      box.innerHTML = list.map(function (w) {
        var img = String(w.image || '');
        var thumb = img
          ? '<img class="work-thumb" src="' + esc(img) + '" alt="">'
          : '<div class="work-thumb ph">无图</div>';
        var linkTag = w.link && /^https?:\/\//i.test(w.link) ? '<span class="tag tag-on">有链接</span>' : '';
        return '<div class="work-item ' + (cur === w.id ? 'active ' : '') + (w.visible === false ? 'hidden-item' : '') + '" data-wid="' + esc(w.id) + '">' +
          thumb +
          '<div class="work-info"><div class="work-title">' + esc(w.title) +
          (w.visible === false ? '<span class="tag tag-off">已下架</span>' : linkTag) + '</div>' +
          '<div class="work-sub">' + (w.desc ? esc(w.desc).slice(0, 40) + (w.desc.length > 40 ? '…' : '') : '暂无介绍') + '</div></div>' +
          '<div class="stu-sort">' +
          '<button class="btn btn-sm" data-act="wup" data-wid="' + esc(w.id) + '" title="上移">↑</button>' +
          '<button class="btn btn-sm" data-act="wdown" data-wid="' + esc(w.id) + '" title="下移">↓</button>' +
          '</div></div>';
      }).join('');
    }
    if (!skipForm) renderEditForm();
  }

  function getSelected() {
    if (!state.data) return null;
    return state.data.students.filter(function (s) { return s.id === state.selected; })[0] || null;
  }
  function getWork(id) {
    var s = getSelected(); if (!s) return null;
    return (s.works || []).filter(function (w) { return w.id === id; })[0] || null;
  }

  // 作品编辑表单
  function renderEditForm() {
    var area = $('edit-area');
    var s = getSelected();
    var w = $('cur-wid') ? getWork($('cur-wid').value) : null;
    if (!s || !w) { area.innerHTML = ''; return; }
    var img = String(w.image || '');
    var preview = /^https?:\/\//i.test(img) || img.indexOf('images/') === 0
      ? '<img class="thumb-preview" src="' + esc(img) + '" alt="预览">'
      : '<div class="thumb-preview" style="display:flex;align-items:center;justify-content:center;color:#86909c">暂无图片</div>';
    area.innerHTML = '<div class="work-edit">' +
      '<h2>编辑作品</h2>' +
      '<div class="form-row">' +
        '<div class="field"><label>作品标题</label><input id="e-title" value="' + esc(w.title) + '"></div>' +
        '<div class="field"><label>作品链接（https://）</label><input id="e-link" value="' + esc(w.link) + '" placeholder="https://..."></div>' +
      '</div>' +
      '<div class="form-row"><div class="field"><label>文字介绍</label><textarea id="e-desc">' + esc(w.desc) + '</textarea></div></div>' +
      '<div class="form-row">' +
        '<div class="field"><label>图片（本地上传，自动压缩）</label><input type="file" id="e-file" accept="image/*"></div>' +
        '<div class="field"><label>或填写图片网址</label><input id="e-imgurl" value="' + (/^https?:\/\//i.test(img) ? esc(img) : '') + '" placeholder="https://..."></div>' +
      '</div>' +
      '<div style="margin-bottom:12px">' + preview + '</div>' +
      '<div class="toolbar">' +
        '<button class="btn" id="btn-upload">上传图片</button>' +
        '<button class="btn" id="btn-savework">保存作品信息</button>' +
        '<button class="btn" id="btn-visible">' + (w.visible === false ? '上架' : '下架') + '</button>' +
        '<button class="btn btn-danger btn-sm" id="btn-delwork">删除作品</button>' +
        '</div></div>';

    // 一改动就提示“有未发布修改”，避免改完忘了发布
    ['e-title', 'e-desc', 'e-link', 'e-imgurl'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('input', function () { markDirty(true); });
    });

    $('btn-savework').onclick = function () {
      var self = this;
      var t = $('e-title').value.trim();
      if (!t) { toast('作品标题不能为空', 'err'); flashBtn(self, 'err'); $('e-title').focus(); return; }
      w.title = t;
      w.desc = $('e-desc').value.trim();
      w.link = $('e-link').value.trim();
      var u = $('e-imgurl').value.trim();
      if (u) w.image = u;

      // 只刷新上方作品列表，不重建表单，避免“闪一下看不出变化”
      renderStudents();
      renderWorks(true);
      markDirty(true);
      toast('作品信息已保存到列表，还需点顶部「保存并发布」才会更新到网站');
      flashBtn(self, 'ok');

      // 按钮自身给出确认反馈
      self.classList.add('saved');
      self.textContent = '✓ 已保存';
      self.disabled = true;
      setTimeout(function () {
        self.classList.remove('saved');
        self.textContent = '保存作品信息';
        self.disabled = false;
      }, 1400);
    };
    $('btn-visible').onclick = function () {
      w.visible = (w.visible === false);
      renderWorks(true); renderEditForm(); markDirty(true);
      status('已' + (w.visible ? '上架' : '下架') + '，记得点「保存并发布」');
    };
    $('btn-delwork').onclick = function () {
      askConfirm({ title: '删除作品', message: '确定删除作品「' + w.title + '」？删除后可通过 Git 历史恢复。', okText: '删除' }, function (ok) {
        if (!ok) return;
        s.works = s.works.filter(function (x) { return x.id !== w.id; });
        $('cur-wid').value = '';
        renderWorks(); markDirty(true); status('作品已删除，记得点「保存并发布」');
      });
    };
    $('btn-upload').onclick = function () {
      var f = $('e-file').files[0];
      if (!f) { status('请先选择图片文件', true); return; }
      status('正在压缩并上传图片…');
      S.compressImage(f, function (err, dataUrl) {
        if (err) { status(err.message, true); return; }
        S.uploadImage(dataUrl, function (e2, path) {
          if (e2) { status(e2.message, true); return; }
          w.image = path;
          renderWorks(true); renderEditForm(); markDirty(true);
          status('图片已上传，记得点「保存并发布」');
        });
      });
    };
  }

  // 把编辑表单里的内容同步回数据（避免改了标题没点「保存作品信息」就发布，导致前台无变化）
  function commitForm() {
    // 网站标题设置
    var stEl = $('set-title');
    if (stEl) {
      state.data.meta = state.data.meta || {};
      var tv = stEl.value.trim();
      if (tv) state.data.meta.title = tv;
      var sbEl = $('set-subtitle');
      state.data.meta.subtitle = sbEl ? sbEl.value.trim() : '';
    }

    var wid = $('cur-wid') ? $('cur-wid').value : '';
    if (!wid) return;
    var w = getWork(wid);
    if (!w) return;
    var tEl = $('e-title');
    if (!tEl) return; // 编辑表单没打开
    var t = String(tEl.value || '').trim();
    if (t) w.title = t;
    var dEl = $('e-desc'); if (dEl) w.desc = dEl.value.trim();
    var lEl = $('e-link'); if (lEl) w.link = lEl.value.trim();
    var iEl = $('e-imgurl'); if (iEl) { var u = iEl.value.trim(); if (u) w.image = u; }
  }

  // 保存发布
  function saveAll() {
    if (!state.data) { toast('请先登录', 'err'); return; }
    commitForm();
    var btn = $('btn-save');
    if (btn.disabled) return;
    btn.disabled = true;
    btn.classList.remove('has-dirty');
    btn.textContent = '正在发布…';
    flashBtn(btn, 'busy');
    toast('正在提交到 GitHub…');

    // 网络无响应时的兜底，避免按钮一直卡住
    var done = false;
    var guard = setTimeout(function () {
      if (done) return;
      done = true;
      btn.disabled = false;
      markDirty(true);
      toast('提交超时，请检查网络后重试。', 'err');
    }, 25000);

    var content = JSON.stringify(state.data, null, 2);
    S.writeFile('data/content.json', content, state.sha, '更新学生作品数据', function (err, res) {
      if (done) return;
      done = true;
      clearTimeout(guard);
      btn.disabled = false;
      if (err) {
        markDirty(true);
        var m = String(err.message || '');
        if (/409|does not match|already exists/i.test(m)) {
          toast('发布失败：仓库数据已被改动，请刷新页面重新登录后再试一次。', 'err');
          flashBtn(btn, 'err');
        } else {
          status(m, true);
        }
        return;
      }
      state.sha = res.content.sha;
      markDirty(false);
      flashBtn(btn, 'ok');
      status('已发布！约 30–60 秒后刷新前台即可看到更新。');
    });
  }

  // 事件绑定
  function bind() {
    // 全局捕获：记录点击的按钮（含列表里动态生成的排序按钮）
    document.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== document) {
        if (t.tagName && t.tagName.toLowerCase() === 'button') { lastClickedBtn = t; break; }
        t = t.parentNode;
      }
      // 动画结束后自动清除反馈色
      var b = lastClickedBtn;
      if (b) setTimeout(function () { clearFlash(b); }, 1400);
    }, true);

    $('btn-login').onclick = doLogin;
    $('in-token').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
    $('btn-logout').onclick = function () {
      askConfirm({ title: '退出登录', message: '退出后需要重新输入令牌才能进入后台，确定退出？', okText: '退出' }, function (ok) {
        if (!ok) return;
        S.clearAuth(); state = { data: null, sha: null, selected: null };
        showLogin(); status('已退出');
      });
    };
    $('btn-save').onclick = saveAll;

    // 网站标题设置
    ['set-title', 'set-subtitle'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('input', function () { markDirty(true); });
    });
    $('btn-save-site').onclick = function () {
      var self = this;
      var stEl = $('set-title'), sbEl = $('set-subtitle');
      var t = stEl ? stEl.value.trim() : '';
      if (!t) { toast('网站标题不能为空', 'err'); flashBtn(self, 'err'); if (stEl) stEl.focus(); return; }
      state.data.meta = state.data.meta || {};
      state.data.meta.title = t;
      state.data.meta.subtitle = sbEl ? sbEl.value.trim() : '';
      markDirty(true);
      toast('标题已保存，还需点顶部「保存并发布」才会更新到网站');
      flashBtn(self, 'ok');
    };

    $('btn-add-student').onclick = function () {
      askText({ title: '新增学生', label: '学生姓名（全名）', placeholder: '例如：张三' }, function (name) {
        if (!name || !name.trim()) return;
        var s = { id: uid('s'), name: name.trim(), visible: true, order: state.data.students.length + 1, works: [] };
        state.data.students.push(s);
        state.selected = s.id;
        renderStudents(); renderWorks(); markDirty(true); status('学生已添加，记得点「保存并发布」');
      });
    };

    $('student-list').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-act]');
      var item = e.target.closest('[data-sid]');
      if (!item) return;
      var sid = item.getAttribute('data-sid');
      var s = state.data.students.filter(function (x) { return x.id === sid; })[0];
      if (!s) return;
      if (btn) {
        var act = btn.getAttribute('data-act');
        var idx = state.data.students.indexOf(s);
        var moved = false;
        if (act === 'up' && idx > 0) { var t = state.data.students[idx - 1]; state.data.students[idx - 1] = s; state.data.students[idx] = t; moved = true; }
        if (act === 'down' && idx < state.data.students.length - 1) { var t2 = state.data.students[idx + 1]; state.data.students[idx + 1] = s; state.data.students[idx] = t2; moved = true; }
        if (!moved) { status('已经是最' + (act === 'up' ? '前' : '后') + '面了'); return; }
        state.data.students.forEach(function (x, i) { x.order = i + 1; });
        renderStudents(); markDirty(true); status('顺序已调整，记得点「保存并发布」');
        return;
      }
      state.selected = sid;
      $('cur-wid').value = '';
      renderStudents(); renderWorks();
      status('已选中「' + s.name + '」，右侧显示其作品');
    });

    $('btn-rename').onclick = function () {
      var s = getSelected(); if (!s) { status('请先选择学生', true); return; }
      askText({ title: '修改学生姓名', label: '姓名', value: s.name }, function (name) {
        if (!name || !name.trim()) return;
        s.name = name.trim();
        renderStudents(); renderWorks(); markDirty(true); status('姓名已修改，记得点「保存并发布」');
      });
    };
    $('btn-stu-visible').onclick = function () {
      var s = getSelected(); if (!s) return;
      s.visible = (s.visible === false);
      renderStudents(); markDirty(true); status('已' + (s.visible ? '上架' : '下架') + '，记得点「保存并发布」');
    };
    $('btn-del-student').onclick = function () {
      var s = getSelected(); if (!s) return;
      askConfirm({ title: '删除学生', message: '确定删除「' + s.name + '」及其全部作品？删除后可通过 Git 历史恢复。', okText: '删除' }, function (ok) {
        if (!ok) return;
        state.data.students = state.data.students.filter(function (x) { return x.id !== s.id; });
        state.selected = state.data.students.length ? state.data.students[0].id : null;
        renderStudents(); renderWorks(); markDirty(true); status('学生已删除，记得点「保存并发布」');
      });
    };

    $('btn-add-work').onclick = function () {
      var s = getSelected(); if (!s) { status('请先选择学生', true); return; }
      askText({ title: '新增作品', label: '作品标题', placeholder: '例如：单词大冒险' }, function (title) {
        if (!title || !title.trim()) return;
        s.works = s.works || [];
        var w = { id: uid('w'), title: title.trim(), desc: '', image: '', link: '', visible: true, order: s.works.length + 1 };
        s.works.push(w);
        $('cur-wid').value = w.id;
        renderWorks(); renderStudents(); markDirty(true); status('作品已添加，记得点「保存并发布」');
      });
    };

    $('work-list').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-act]');
      var item = e.target.closest('[data-wid]');
      if (!item) return;
      var wid = item.getAttribute('data-wid');
      var s = getSelected();
      var w = (s.works || []).filter(function (x) { return x.id === wid; })[0];
      if (!w) return;
      if (btn && (btn.getAttribute('data-act') === 'wup' || btn.getAttribute('data-act') === 'wdown')) {
        var act = btn.getAttribute('data-act');
        var idx = s.works.indexOf(w);
        var moved = false;
        if (act === 'wup' && idx > 0) { var t = s.works[idx - 1]; s.works[idx - 1] = w; s.works[idx] = t; moved = true; }
        if (act === 'wdown' && idx < s.works.length - 1) { var t2 = s.works[idx + 1]; s.works[idx + 1] = w; s.works[idx] = t2; moved = true; }
        if (!moved) { status('已经是最' + (act === 'wup' ? '前' : '后') + '面了'); return; }
        s.works.forEach(function (x, i) { x.order = i + 1; });
        renderWorks(true); markDirty(true); status('顺序已调整，记得点「保存并发布」');
        return;
      }
      $('cur-wid').value = wid;
      renderEditForm();
      status('已选中作品「' + w.title + '」，可在下方编辑');
    });
  }

  function init() {
    $('in-repo').value = C.defaultRepo || 'club-works';
    $('in-branch').value = C.defaultBranch || 'main';
    if (S.isLoggedIn()) {
      $('in-owner').value = S.getOwner();
      $('in-repo').value = S.getRepo();
      $('in-branch').value = S.getBranch();
      status('正在连接 GitHub…');
      loadData();
    }
    bind();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
