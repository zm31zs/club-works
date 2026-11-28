/* 互动模块：通过 CloudBase 读写点赞与留言（无数据库服务器，数据存 CloudBase 集合）
 * 未配置 cloudEnv 时全部功能静默降级，不影响前台浏览与后台作品管理。
 */
(function (global) {
  'use strict';
  var C = global.SITE_CONFIG || {};
  var SDK_URL = 'https://static.cloudbase.net/cloudbase-js-sdk/3.0.0/cloudbase.full.js';
  var LIKES = 'work_likes';
  var COMMENTS = 'work_comments';
  var VISITOR_KEY = 'clubworks_visitor';
  var app = null;
  var loading = null;

  function configured() { return !!(C.cloudEnv && String(C.cloudEnv).trim()); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  function visitorId() {
    var v = '';
    try { v = localStorage.getItem(VISITOR_KEY) || ''; } catch (e) {}
    if (!v) {
      v = 'v_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem(VISITOR_KEY, v); } catch (e) {}
    }
    return v;
  }

  // 动态加载官方 SDK：仅在已配置时加载，避免未配置时拖慢页面
  function loadSdk(cb) {
    if (global.cloudbase && global.cloudbase.init) { cb(null); return; }
    if (loading) { loading.push(cb); return; }
    loading = [cb];
    var s = document.createElement('script');
    s.src = SDK_URL;
    s.onload = function () {
      var list = loading; loading = null;
      if (global.cloudbase && global.cloudbase.init) list.forEach(function (f) { f(null); });
      else list.forEach(function (f) { f(new Error('CloudBase SDK 未正确加载')); });
    };
    s.onerror = function () {
      var list = loading; loading = null;
      list.forEach(function (f) { f(new Error('CloudBase SDK 加载失败，请检查网络')); });
    };
    document.head.appendChild(s);
  }

  function getInstance(cb) {
    if (!configured()) { cb(new Error('互动功能尚未配置')); return; }
    if (app) { cb(null, app); return; }
    loadSdk(function (err) {
      if (err) { cb(err); return; }
      try {
        var opt = { env: String(C.cloudEnv).trim(), region: C.cloudRegion || 'ap-shanghai' };
        if (C.cloudKey && String(C.cloudKey).trim()) opt.accessKey = String(C.cloudKey).trim();
        app = global.cloudbase.init(opt);
        // 未使用 Publishable Key 时，尝试匿名登录（需在控制台开启匿名登录）
        if (!opt.accessKey) {
          var auth = app.auth;
          if (auth && typeof auth.signInAnonymously === 'function') {
            auth.signInAnonymously().then(function () { cb(null, app); })
              .catch(function (e) { cb(e); });
            return;
          }
        }
        cb(null, app);
      } catch (e) { cb(e); }
    });
  }

  function db(cb) {
    getInstance(function (err, a) {
      if (err) { cb(err); return; }
      try { cb(null, a.database()); } catch (e) { cb(e); }
    });
  }

  // 取全部点赞与留言记录（作品展规模小，一次取回后在前端聚合，减少请求）
  function loadAll(cb) {
    db(function (err, d) {
      if (err) { cb(err); return; }
      var likes = [], comments = [];
      function done() { cb(null, { likes: likes, comments: comments }); }
      d.collection(LIKES).limit(1000).get()
        .then(function (r) { likes = (r && r.data) || []; })
        .catch(function () {})
        .then(function () { return d.collection(COMMENTS).orderBy('createdAt', 'desc').limit(1000).get(); })
        .then(function (r) { comments = (r && r.data) || []; done(); })
        .catch(function (e) { cb(e); });
    });
  }

  // 按作品聚合：{ [workId]: { likes: n, comments: n, liked: bool } }
  function stats(all) {
    var out = {};
    var me = visitorId();
    (all.likes || []).forEach(function (x) {
      var k = x.workId;
      if (!k) return;
      if (!out[k]) out[k] = { likes: 0, comments: 0, liked: false };
      out[k].likes++;
      if (x.visitorId === me) out[k].liked = true;
    });
    (all.comments || []).forEach(function (x) {
      var k = x.workId;
      if (!k) return;
      if (!out[k]) out[k] = { likes: 0, comments: 0, liked: false };
      out[k].comments++;
    });
    return out;
  }

  // 点赞 / 取消点赞（同一访客对同一作品仅一条记录）
  function toggleLike(workId, studentId, cb) {
    db(function (err, d) {
      if (err) { cb(err); return; }
      var me = visitorId();
      d.collection(LIKES).where({ workId: workId, visitorId: me }).limit(1).get()
        .then(function (r) {
          var rows = (r && r.data) || [];
          if (rows.length) {
            return d.collection(LIKES).doc(rows[0]._id).remove().then(function () { return false; });
          }
          return d.collection(LIKES).add({
            workId: workId, studentId: studentId || '', visitorId: me, createdAt: Date.now()
          }).then(function () { return true; });
        })
        .then(function (liked) { cb(null, liked); })
        .catch(function (e) { cb(e); });
    });
  }

  function addComment(workId, studentId, nickname, content, cb) {
    db(function (err, d) {
      if (err) { cb(err); return; }
      d.collection(COMMENTS).add({
        workId: workId, studentId: studentId || '',
        nickname: String(nickname || '同学').slice(0, 20),
        content: String(content || '').slice(0, 300),
        createdAt: Date.now()
      }).then(function () { cb(null); }).catch(function (e) { cb(e); });
    });
  }

  function timeText(ts) {
    var n = Number(ts) || 0;
    if (!n) return '';
    var d = new Date(n);
    if (isNaN(d.getTime())) return '';
    function p(x) { return x < 10 ? '0' + x : '' + x; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  global.CWSocial = {
    configured: configured,
    visitorId: visitorId,
    esc: esc,
    timeText: timeText,
    loadAll: loadAll,
    stats: stats,
    toggleLike: toggleLike,
    addComment: addComment,
    collections: { likes: LIKES, comments: COMMENTS }
  };
})(window);
