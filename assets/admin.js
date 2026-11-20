/* 后台管理逻辑：登录、学生/作品增删改、图片上传、保存提交 */
(function (global) {
  'use strict';
  var C = global.SITE_CONFIG || {};
  var S = global.CWStore;
  var state = { data: null, sha: null, selected: null };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  function uid(p) { return p + '_' + Date.now().toString(36) + Math.floor(Math.random() * 1000); }
  function status(msg, isErr) {
    var el = $('status');
    if (el) { el.textContent = msg || ''; el.className = 'status' + (isErr ? ' err' : ''); }
  }
  function blankData() { return { meta: { title: C.siteTitle || '作品展' }, students: [] }; }

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
        status('数据文件不存在，将新建。', true);
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
    if (!list.length) {
      box.innerHTML = '<div class="mini" style="padding:10px">还没有学生，点下方「新增学生」</div>';
      return;
    }
    box.innerHTML = list.map(function (s, i) {
      var works = (s.works || []).length;
      return '<div class="list-item ' + (s.id === state.selected ? 'active ' : '') + (s.visible === false ? 'hidden-item' : '') + '" data-sid="' + esc(s.id) + '">' +
        '<span class="grow">' + esc(s.name) + ' <span class="mini">· ' + works + ' 件</span>' + (s.visible === false ? ' <span class="mini">[已下架]</span>' : '') + '</span>' +
        '<button class="btn btn-sm" data-act="up" data-sid="' + esc(s.id) + '" title="上移">↑</button>' +
        '<button class="btn btn-sm" data-act="down" data-sid="' + esc(s.id) + '" title="下移">↓</button>' +
        '</div>';
    }).join('');
  }

  // 作品列表（右侧）
  function renderWorks() {
    var box = $('work-list');
    var s = getSelected();
    if (!s) { box.innerHTML = '<div class="mini" style="padding:10px">请先选择或新增学生</div>'; $('edit-area').innerHTML = ''; return; }
    $('work-student-name').textContent = s.name;
    var list = (s.works || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    if (!list.length) { box.innerHTML = '<div class="mini" style="padding:10px">该学生还没有作品</div>'; }
    else {
      box.innerHTML = list.map(function (w) {
        return '<div class="list-item ' + (w.visible === false ? 'hidden-item' : '') + '" data-wid="' + esc(w.id) + '">' +
          '<span class="grow">' + esc(w.title) + (w.visible === false ? ' <span class="mini">[已下架]</span>' : '') + '</span>' +
          '<button class="btn btn-sm" data-act="wup" data-wid="' + esc(w.id) + '">↑</button>' +
          '<button class="btn btn-sm" data-act="wdown" data-wid="' + esc(w.id) + '">↓</button>' +
          '</div>';
      }).join('');
    }
    renderEditForm();
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

    $('btn-savework').onclick = function () {
      w.title = $('e-title').value.trim();
      w.desc = $('e-desc').value.trim();
      w.link = $('e-link').value.trim();
      var u = $('e-imgurl').value.trim();
      if (u) w.image = u;
      renderWorks(); status('作品信息已修改，记得点「保存并发布」');
    };
    $('btn-visible').onclick = function () {
      w.visible = (w.visible === false);
      renderWorks(); status('已' + (w.visible ? '上架' : '下架') + '，记得点「保存并发布」');
    };
    $('btn-delwork').onclick = function () {
      if (!confirm('确定删除作品「' + w.title + '」？删除后仍可通过 Git 历史恢复。')) return;
      s.works = s.works.filter(function (x) { return x.id !== w.id; });
      $('cur-wid').value = '';
      renderWorks(); status('作品已删除，记得点「保存并发布」');
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
          renderWorks(); status('图片已上传，记得点「保存并发布」');
        });
      });
    };
  }

  // 保存发布
  function saveAll() {
    if (!state.data) { status('请先登录', true); return; }
    var btn = $('btn-save');
    btn.disabled = true;
    status('正在提交到 GitHub…');
    var content = JSON.stringify(state.data, null, 2);
    S.writeFile('data/content.json', content, state.sha, '更新学生作品数据', function (err, res) {
      btn.disabled = false;
      if (err) { status(err.message, true); return; }
      state.sha = res.content.sha;
      status('已发布！约 30–60 秒后刷新前台即可看到更新。');
    });
  }

  // 事件绑定
  function bind() {
    $('btn-login').onclick = doLogin;
    $('in-token').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
    $('btn-logout').onclick = function () {
      if (!confirm('退出后需重新输入令牌，确定退出？')) return;
      S.clearAuth(); state = { data: null, sha: null, selected: null };
      showLogin(); status('已退出');
    };
    $('btn-save').onclick = saveAll;

    $('btn-add-student').onclick = function () {
      var name = prompt('输入学生姓名（全名）：');
      if (!name || !name.trim()) return;
      var s = { id: uid('s'), name: name.trim(), visible: true, order: state.data.students.length + 1, works: [] };
      state.data.students.push(s);
      state.selected = s.id;
      renderStudents(); renderWorks(); status('学生已添加，记得点「保存并发布」');
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
        if (act === 'up' && idx > 0) { var t = state.data.students[idx - 1]; state.data.students[idx - 1] = s; state.data.students[idx] = t; }
        if (act === 'down' && idx < state.data.students.length - 1) { var t2 = state.data.students[idx + 1]; state.data.students[idx + 1] = s; state.data.students[idx] = t2; }
        state.data.students.forEach(function (x, i) { x.order = i + 1; });
        renderStudents(); status('顺序已调整，记得点「保存并发布」');
        return;
      }
      state.selected = sid;
      $('cur-wid').value = '';
      renderStudents(); renderWorks();
    });

    $('btn-rename').onclick = function () {
      var s = getSelected(); if (!s) { status('请先选择学生', true); return; }
      var name = prompt('修改姓名：', s.name);
      if (!name || !name.trim()) return;
      s.name = name.trim();
      renderStudents(); renderWorks(); status('姓名已修改，记得点「保存并发布」');
    };
    $('btn-stu-visible').onclick = function () {
      var s = getSelected(); if (!s) return;
      s.visible = (s.visible === false);
      renderStudents(); status('已' + (s.visible ? '上架' : '下架') + '，记得点「保存并发布」');
    };
    $('btn-del-student').onclick = function () {
      var s = getSelected(); if (!s) return;
      if (!confirm('确定删除学生「' + s.name + '」及其全部作品？可用 Git 历史恢复。')) return;
      state.data.students = state.data.students.filter(function (x) { return x.id !== s.id; });
      state.selected = state.data.students.length ? state.data.students[0].id : null;
      renderStudents(); renderWorks(); status('学生已删除，记得点「保存并发布」');
    };

    $('btn-add-work').onclick = function () {
      var s = getSelected(); if (!s) { status('请先选择学生', true); return; }
      var title = prompt('输入作品标题：');
      if (!title || !title.trim()) return;
      s.works = s.works || [];
      var w = { id: uid('w'), title: title.trim(), desc: '', image: '', link: '', visible: true, order: s.works.length + 1 };
      s.works.push(w);
      $('cur-wid').value = w.id;
      renderWorks(); renderStudents(); status('作品已添加，记得点「保存并发布」');
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
        if (act === 'wup' && idx > 0) { var t = s.works[idx - 1]; s.works[idx - 1] = w; s.works[idx] = t; }
        if (act === 'wdown' && idx < s.works.length - 1) { var t2 = s.works[idx + 1]; s.works[idx + 1] = w; s.works[idx] = t2; }
        s.works.forEach(function (x, i) { x.order = i + 1; });
        renderWorks(); status('顺序已调整，记得点「保存并发布」');
        return;
      }
      $('cur-wid').value = wid;
      renderEditForm();
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
