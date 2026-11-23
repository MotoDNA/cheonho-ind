/**
 * 천호산업 홈페이지 관리자 저장 서버 (Google Apps Script)
 *
 * 하는 일
 *  - 홈페이지가 읽어 가는 내용(고친 문구, 바꾼 사진, 제작 사례 목록)을 구글 시트에 보관합니다.
 *  - 관리자 페이지에서 비밀번호가 맞을 때만 저장합니다.
 *  - 저장할 때마다 '기록' 시트에 이전 내용을 남겨, 언제든 되돌릴 수 있습니다.
 *  - 사진은 구글 드라이브 '천호산업 홈페이지 사진' 폴더에 올립니다.
 *
 * 처음 한 번 할 일
 *  1) 왼쪽 톱니바퀴 [프로젝트 설정] > 맨 아래 [스크립트 속성] > [스크립트 속성 추가]
 *     속성: ADMIN_PASSWORD / 값: 관리자 비밀번호  → 저장
 *  2) 위쪽 실행할 함수에서 setup 을 골라 ▶실행 (권한 허용)
 *  3) 배포 > 새 배포 > 웹 앱 / 실행: 나 / 액세스 권한: 모든 사용자 > 배포 → 나오는 주소(…/exec)
 */

const DATA_SHEET = '내용';
const LOG_SHEET = '기록';
const MAX_CHARS = 45000;       // 시트 칸 하나에 들어가는 글자 수 한도보다 조금 작게
const MAX_FAILS = 8;           // 10분 동안 비밀번호를 이만큼 틀리면 잠시 막습니다
const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_UPLOAD_MB = 8;
const FOLDER_NAME = '천호산업 홈페이지 사진';

/** 처음 한 번 실행: 시트 만들기 + 기본 내용 넣기 + 사진 폴더 만들기 */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('이 스크립트는 구글 시트의 [확장 프로그램 > Apps Script]에서 만들어야 합니다.');
  const data = ss.getSheetByName(DATA_SHEET) || ss.insertSheet(DATA_SHEET);
  const log = ss.getSheetByName(LOG_SHEET) || ss.insertSheet(LOG_SHEET);
  data.getRange('A1').setValue('홈페이지 내용 (직접 고치지 마세요. 관리자 페이지에서 고칩니다)');
  if (log.getLastRow() === 0) log.appendRow(['저장 시각', '내용', '저장 전 내용(되돌리기용)']);
  log.getRange('A:A').setNumberFormat('@');
  if (!data.getRange('A2').getValue()) data.getRange('A2').setValue(JSON.stringify(DEFAULT_CONTENT));
  photoFolder_();
  if (!PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD')) {
    throw new Error('[프로젝트 설정 > 스크립트 속성]에 ADMIN_PASSWORD 를 먼저 넣어 주세요.');
  }
  return '준비 완료';
}

/** 홈페이지·관리자 페이지가 내용을 읽어 갈 때 (누구나 읽기 가능) */
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'content';
  if (action === 'content') return json_(readContent_());
  return json_({ ok: false, error: '알 수 없는 요청입니다.' });
}

/** 관리자 페이지에서 로그인·저장·기록·사진 요청 (비밀번호 필요) */
function doPost(e) {
  let req = {};
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: '요청 형식이 올바르지 않습니다.' }); }

  const gate = checkPassword_(req.password);
  if (gate) return json_({ ok: false, error: gate });

  switch (req.action) {
    case 'login': return json_({ ok: true });
    case 'save': return json_(save_(req.content, req.note));
    case 'history': return json_({ ok: true, items: history_() });
    case 'restore': return json_(restore_(req.time));
    case 'upload': return json_(upload_(req));
    case 'trash': return json_(trash_(req.ids));
    default: return json_({ ok: false, error: '알 수 없는 요청입니다.' });
  }
}

/* ---------------- 사진 ---------------- */
function photoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PHOTO_FOLDER');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const folder = DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('PHOTO_FOLDER', folder.getId());
  return folder;
}

function upload_(req) {
  try {
    const mime = String(req.mime || '');
    if (UPLOAD_TYPES.indexOf(mime) < 0) return { ok: false, error: '사진(JPG·PNG·WEBP)만 올릴 수 있습니다.' };
    const bytes = Utilities.base64Decode(String(req.data || ''));
    if (bytes.length > MAX_UPLOAD_MB * 1024 * 1024) return { ok: false, error: '사진이 너무 큽니다. ' + MAX_UPLOAD_MB + 'MB 이하로 올려 주세요.' };
    const name = String(req.name || '사진').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
    const file = photoFolder_().createFile(Utilities.newBlob(bytes, mime, name));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { ok: true, id: file.getId() };
  } catch (err) {
    return { ok: false, error: '사진을 저장하지 못했습니다: ' + err.message };
  }
}

/** 바꾼 사진의 예전 파일은 드라이브 휴지통으로 (30일 안에는 드라이브에서 되살릴 수 있음) */
function trash_(ids) {
  const folderId = photoFolder_().getId();
  let n = 0;
  (ids || []).forEach(function (id) {
    try {
      const f = DriveApp.getFileById(String(id));
      const parents = f.getParents();
      let inFolder = false;
      while (parents.hasNext()) { if (parents.next().getId() === folderId) inFolder = true; }
      if (inFolder) { f.setTrashed(true); n++; }
    } catch (e) {}
  });
  return { ok: true, trashed: n };
}

/* ---------------- 내부 함수 ---------------- */
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function checkPassword_(pw) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('fails') || 0);
  if (fails >= MAX_FAILS) return '비밀번호를 여러 번 틀려서 10분 동안 잠겼습니다. 잠시 후 다시 시도해 주세요.';
  const real = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!real) return '관리자 비밀번호가 아직 설정되지 않았습니다.';
  if (String(pw || '') !== real) {
    cache.put('fails', String(fails + 1), 600);
    return '비밀번호가 맞지 않습니다.';
  }
  return '';
}

function sheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return { data: ss.getSheetByName(DATA_SHEET), log: ss.getSheetByName(LOG_SHEET) };
}

function readContent_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('content');
  if (hit) return JSON.parse(hit);
  const raw = sheets_().data.getRange('A2').getValue();
  const content = raw ? JSON.parse(raw) : DEFAULT_CONTENT;
  const text = JSON.stringify(content);
  if (text.length < 90000) cache.put('content', text, 300);
  return content;
}

function clean_(c) {
  if (!c || typeof c !== 'object') throw new Error('저장할 내용이 비어 있습니다.');
  if (c.texts != null && typeof c.texts !== 'object') throw new Error('문구 형식이 올바르지 않습니다.');
  if (c.images != null && typeof c.images !== 'object') throw new Error('사진 형식이 올바르지 않습니다.');
  if (c.works != null && !Array.isArray(c.works)) throw new Error('제작 사례 형식이 올바르지 않습니다.');
  const text = JSON.stringify(c);
  if (text.length > MAX_CHARS) throw new Error('내용이 너무 깁니다. 제작 사례 몇 개를 지운 뒤 다시 저장해 주세요.');
  return text;
}

function save_(content, note) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: '다른 저장이 진행 중입니다. 잠시 후 다시 눌러 주세요.' };
  try {
    content.updated = new Date().toISOString();
    const text = clean_(content);
    const s = sheets_();
    const before = s.data.getRange('A2').getValue();
    s.data.getRange('A2').setValue(text);
    s.log.appendRow([content.updated, String(note || '저장').slice(0, 200), before]);
    trimLog_(s.log);
    CacheService.getScriptCache().remove('content');
    return { ok: true, updated: content.updated };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    lock.releaseLock();
  }
}

function trimLog_(log) {
  const keep = 200;
  const rows = log.getLastRow() - 1;
  if (rows > keep) log.deleteRows(2, rows - keep);
}

function history_() {
  const log = sheets_().log;
  const n = log.getLastRow() - 1;
  if (n <= 0) return [];
  const take = Math.min(n, 20);
  const vals = log.getRange(log.getLastRow() - take + 1, 1, take, 2).getValues();
  return vals.reverse().map(function (r) {
    return { time: r[0] instanceof Date ? r[0].toISOString() : String(r[0]), note: String(r[1]) };
  });
}

/** 'time' 에 저장하기 바로 전 상태로 되돌립니다. */
function restore_(time) {
  const log = sheets_().log;
  const n = log.getLastRow() - 1;
  if (n <= 0) return { ok: false, error: '되돌릴 기록이 없습니다.' };
  const vals = log.getRange(2, 1, n, 3).getValues();
  const t = function (v) { return v instanceof Date ? v.toISOString() : String(v); };
  for (let i = 0; i < vals.length; i++) {
    if (t(vals[i][0]) === String(time)) {
      const snapshot = vals[i][2];
      if (!snapshot) break;
      return save_(JSON.parse(snapshot), '되돌리기: ' + String(vals[i][1]).slice(0, 80) + ' 이전으로');
    }
  }
  return { ok: false, error: '그 시점의 내용을 찾지 못했습니다.' };
}

/* 처음 넣어 둘 내용 (현재 홈페이지와 같음: 고친 문구·사진 없음, 제작 사례 예시 12개) */
const DEFAULT_CONTENT = {"version": 1, "texts": {}, "images": {}, "works": [{"cat": "diary", "name": "다이어리 표지", "spec": "유색 PVC · 금박", "img": "", "color": "c-navy"}, {"cat": "diary", "name": "수첩 커버", "spec": "레자 · 형압", "img": "", "color": "c-brown"}, {"cat": "binder", "name": "링바인더", "spec": "합지+PVC · 실크 인쇄", "img": "", "color": "c-black"}, {"cat": "clear", "name": "책 커버", "spec": "투명 PVC", "img": "", "color": "c-clear"}, {"cat": "case", "name": "여권 케이스", "spec": "반투명 PVC", "img": "", "color": "c-grey"}, {"cat": "etc", "name": "상장 케이스", "spec": "레자 · 금박", "img": "", "color": "c-wine"}, {"cat": "etc", "name": "메뉴판", "spec": "유색 PVC", "img": "", "color": "c-green"}, {"cat": "binder", "name": "결재판", "spec": "합지+PVC", "img": "", "color": "c-navy"}, {"cat": "case", "name": "통장 케이스", "spec": "투명 PVC", "img": "", "color": "c-clear"}, {"cat": "etc", "name": "앨범 표지", "spec": "쿠션 표지", "img": "", "color": "c-ochre"}, {"cat": "case", "name": "명찰 케이스", "spec": "투명 PVC", "img": "", "color": "c-clear"}, {"cat": "etc", "name": "포켓 가공", "spec": "투명 PVC", "img": "", "color": "c-grey"}]};
