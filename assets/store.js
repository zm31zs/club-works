/* 数据读写公共模块：前台只读 JSON；后台通过 GitHub REST API 读写仓库文件 */
(function (global) {
  'use strict';

  var C = global.SITE_CONFIG || {};
  var TOKEN_KEY = 'clubworks_token';
  var OWNER_KEY = 'clubworks_owner';
  var REPO_KEY = 'clubworks_repo';
  var BRANCH_KEY = 'clubworks_branch';

  function getSetting(key) { try { return localStorage.getItem(key) || ''; } catch (e) { return ''; } }
  function setSetting(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }
  function removeSetting(key) { try { localStorage.removeItem(key); } catch (e) {} }

  function getToken() { return getSetting(TOKEN_KEY); }
  function getOwner() { return getSetting(OWNER_KEY); }
  function getRepo() { return getSetting(REPO_KEY); }
  function getBranch() { return getSetting(BRANCH_KEY) || C.defaultBranch || 'main'; }
  function saveAuth(owner, repo, branch, token) {
    setSetting(OWNER_KEY, owner); setSetting(REPO_KEY, repo);
    setSetting(BRANCH_KEY, branch); setSetting(TOKEN_KEY, token);
  }
  function clearAuth() {
    removeSetting(TOKEN_KEY); removeSetting(OWNER_KEY);
    removeSetting(REPO_KEY); removeSetting(BRANCH_KEY);
  }
  function isLoggedIn() { return !!(getToken() && getOwner() && getRepo()); }
  function isPublicConfigured() { return !!(C.owner && C.repo); }

  // 前台：读取静态数据文件
  function loadPublic(cb) {
    var url = 'data/content.json?t=' + Date.now();
    fetch(url, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('无法读取 data/content.json（HTTP ' + r.status + '）');
        return r.json();
      })
      .then(function (data) { cb(null, data); })
      .catch(function (err) { cb(err); });
  }

  // 后台：GitHub Contents API
  function api(path) {
    var owner = getOwner(), repo = getRepo();
    return 'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/contents/' + path;
  }
  function headers() {
    return {
      'Authorization': 'Bearer ' + getToken(),
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json'
    };
  }

  function utf8ToBase64(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function base64ToUtf8(b64) {
    var bin = atob((b64 || '').replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // 读取仓库文件内容，返回 {content, sha}；不存在则 content 为 null
  function readFile(path, cb) {
    var owner = getOwner(), repo = getRepo(), branch = getBranch();
    var repoUrl = 'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo);
    fetch(api(path) + '?ref=' + encodeURIComponent(branch), { headers: headers() })
      .then(function (r) {
        if (r.ok) return r.json().then(function (j) { return { j: j }; });
        if (r.status === 404) {
          // 404 可能是"文件不存在"，也可能是"仓库填错/令牌无权"，需二次确认
          return fetch(repoUrl, { headers: headers() }).then(function (rr) {
            if (rr.ok) return { notfound: true };
            return rr.json().catch(function () { return {}; }).then(function (j) {
              throw new Error('无法访问仓库 ' + owner + '/' + repo + '：' + (j.message || rr.status) + '。请检查用户名、仓库名是否正确，令牌是否授权了这个仓库。');
            });
          });
        }
        return r.json().catch(function () { return {}; }).then(function (j) {
          var msg = j.message || r.status;
          if (r.status === 401 || r.status === 403) msg += '（令牌无效或权限不足，需 Contents 读和写）';
          throw new Error('读取失败：' + msg);
        });
      })
      .then(function (res) {
        if (res.notfound) return cb(null, { content: null, sha: null });
        cb(null, { content: base64ToUtf8(res.j.content), sha: res.j.sha });
      })
      .catch(function (e) { cb(e); });
  }

  // 写入（新建或更新）仓库文件
  function writeFile(path, text, sha, message, cb) {
    var body = { message: message, content: utf8ToBase64(text), branch: getBranch() };
    if (sha) body.sha = sha;
    fetch(api(path), { method: 'PUT', headers: headers(), body: JSON.stringify(body) })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (j) { throw new Error('保存失败：' + (j.message || r.status)); });
        return r.json();
      })
      .then(function (j) { cb(null, j); })
      .catch(function (e) { cb(e); });
  }

  // 压缩图片为 dataURL（最长边 1600，JPEG 0.8）
  function compressImage(file, cb) {
    var reader = new FileReader();
    reader.onerror = function () { cb(new Error('读取图片失败')); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { cb(new Error('图片解析失败')); };
      img.onload = function () {
        var w = img.width, h = img.height, max = 1600;
        if (w > max || h > max) {
          var ratio = Math.min(max / w, max / h);
          w = Math.round(w * ratio); h = Math.round(h * ratio);
        }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        cb(null, canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  // 上传图片到 images/ 目录，返回相对路径
  function uploadImage(dataUrl, cb) {
    var ext = 'jpg';
    var name = 'img_' + Date.now() + '_' + Math.floor(Math.random() * 1000) + '.' + ext;
    var path = 'images/' + name;
    var b64 = dataUrl.split(',')[1];
    var body = { message: '上传作品图片 ' + name, content: b64, branch: getBranch() };
    fetch(api(path), { method: 'PUT', headers: headers(), body: JSON.stringify(body) })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (j) { throw new Error('图片上传失败：' + (j.message || r.status)); });
        return r.json();
      })
      .then(function () { cb(null, path); })
      .catch(function (e) { cb(e); });
  }

  global.CWStore = {
    getToken: getToken, getOwner: getOwner, getRepo: getRepo, getBranch: getBranch,
    saveAuth: saveAuth, clearAuth: clearAuth, isLoggedIn: isLoggedIn, isPublicConfigured: isPublicConfigured,
    loadPublic: loadPublic, readFile: readFile, writeFile: writeFile,
    compressImage: compressImage, uploadImage: uploadImage
  };
})(window);
