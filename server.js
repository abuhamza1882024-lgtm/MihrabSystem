// MIHRAB server – no dependencies, needs only Node.js (v18+)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = +process.env.PORT || 3000;
const DIR = __dirname;
const DATA_FILE = path.join(DIR, process.env.DATA || 'data.json');

const hash = (password, salt) => {
  salt = salt || crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(String(password), salt, 32).toString('hex');
};

const ok = (password, storedHash) => {
  if (!storedHash) return false;
  const [salt, value] = storedHash.split(':');
  return crypto.timingSafeEqual(
    Buffer.from(hash(password, salt).split(':')[1], 'hex'),
    Buffer.from(value, 'hex')
  );
};

const seed = () => ({
  users: [
    { u: 'admin', h: hash('admin123'), role: 'admin' },
    { u: 'hr', h: hash('hr123'), role: 'hr' }
  ],
  teachers: [],
  students: [],
  subjects: ['Quran', 'Arabic Language', 'Islamic Studies'],
  slots: [],
  lessons: [],
  pay: {},
  audit: [],
  shared: {},
  n: { t: 1, s: 1, sl: 1, l: 1 }
});

let db = fs.existsSync(DATA_FILE)
  ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
  : seed();

db.cancels = db.cancels || [];
db.reminders = db.reminders || [];
db.settings = db.settings || { pay: '' };

const persist = () => {
  fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(db));
  fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
};

const backup = () => {
  try {
    fs.mkdirSync(path.join(DIR, 'backups'), { recursive: true });
    fs.copyFileSync(
      DATA_FILE,
      path.join(DIR, 'backups', 'data-' + new Date().toISOString().slice(0, 10) + '.json')
    );
  } catch (error) {}
};

persist();
backup();
setInterval(backup, 6 * 36e5);

const strip = (object, ...keys) => {
  const result = { ...object };
  keys.forEach(key => delete result[key]);
  return result;
};

const toMin = time => {
  const [hours, minutes] = time.split(':').map(Number);
  const total = hours * 60 + minutes;
  return total < 720 ? total + 1440 : total;
};

function view(session) {
  const base = { subjects: db.subjects, n: db.n };

  if (session.role == 'admin') {
    return {
      ...db,
      waAuto: auto(),
      users: db.users.map(user => strip(user, 'h'))
    };
  }

  if (session.role == 'hr') {
    return {
      ...base,
      teachers: db.teachers.map(teacher => strip(teacher, 'rate')),
      students: db.students.map(student => strip(student, 'rate')),
      slots: db.slots,
      lessons: db.lessons.map(lesson => strip(lesson, 'tr', 'sr')),
      cancels: db.cancels,
      reminders: db.reminders.slice(0, 50),
      waAuto: auto(),
      users: [],
      pay: {},
      audit: [],
      shared: {}
    };
  }

  const slots = db.slots.filter(slot => slot.tid == session.tid);
  const lessons = db.lessons
    .filter(lesson => lesson.tid == session.tid)
    .map(lesson => strip(lesson, 'sr'));
  const studentIds = new Set([
    ...slots.map(slot => slot.sid),
    ...lessons.map(lesson => lesson.sid)
  ]);
  const sharedPattern = new RegExp('^t' + session.tid + '(\\d{4}-\\d{2})?$');

  return {
    ...base,
    teachers: db.teachers.filter(teacher => teacher.id == session.tid),
    students: db.students
      .filter(student => studentIds.has(student.id))
      .map(student => strip(student, 'rate', 'phone')),
    slots,
    lessons,
    cancels: db.cancels.filter(cancel => slots.some(slot => slot.id == cancel.slot)),
    users: [],
    pay: {},
    audit: [],
    shared: Object.fromEntries(
      Object.entries(db.shared || {}).filter(([key]) => sharedPattern.test(key))
    )
  };
}

function merge(session, clientDb, restore) {
  if (
    !clientDb ||
    ['teachers', 'students', 'slots', 'lessons'].some(key => !Array.isArray(clientDb[key]))
  ) {
    return 'Invalid data';
  }

  const mergeAudit = () => {
    const seen = new Set(db.audit.map(entry => entry.t + entry.by + entry.m));
    [...(clientDb.audit || [])].reverse().forEach(entry => {
      if (entry && !seen.has(entry.t + entry.by + entry.m)) {
        db.audit.unshift({
          t: String(entry.t),
          by: session.u,
          m: String(entry.m).slice(0, 300)
        });
      }
    });
    db.audit = db.audit.slice(0, 500);
  };

  if (session.role == 'admin') {
    const users = (clientDb.users || []).map(user => {
      const current = db.users.find(existing => existing.u == user.u);
      return {
        u: String(user.u),
        role: user.role,
        tid: user.tid,
        h: user.p ? hash(user.p) : current ? current.h : hash('ChangeMe123')
      };
    });

    if (
      !users.some(user => user.role == 'admin') ||
      users.some(user => !['admin', 'hr', 'teacher'].includes(user.role))
    ) {
      return 'At least one admin is required';
    }

    if (restore) {
      db.lessons = clientDb.lessons;
    } else {
      const lessons = new Map(db.lessons.map(lesson => [lesson.id, lesson]));
      clientDb.lessons.forEach(lesson => lessons.set(lesson.id, lesson));
      db.lessons = [...lessons.values()];
    }

    db.users = users;
    db.teachers = clientDb.teachers.map(teacher => ({
      ...teacher,
      photo:
        typeof teacher.photo == 'string' &&
        teacher.photo.startsWith('data:image/') &&
        teacher.photo.length < 150000
          ? teacher.photo
          : '',
      edu: String(teacher.edu || '').slice(0, 200),
      payMethod: String(teacher.payMethod || '').slice(0, 200)
    }));
    db.students = clientDb.students.map(cleanS);
    db.subjects = clientDb.subjects;
    db.slots = clientDb.slots;
    db.pay = clientDb.pay || {};
    db.shared = clientDb.shared || {};
    mergeAudit();
  } else if (session.role == 'hr') {
    db.slots = clientDb.slots;
    db.students = clientDb.students.map(student => {
      const current = db.students.find(existing => existing.id == student.id);
      return { ...cleanS(student), rate: current ? current.rate : 0 };
    });

    clientDb.teachers.forEach(teacher => {
      const current = db.teachers.find(existing => existing.id == teacher.id);
      if (!current) return;
      if (String(teacher.name || '').trim()) {
        current.name = String(teacher.name).trim().slice(0, 100);
      }
      current.payMethod = String(teacher.payMethod || '').slice(0, 200);
      if (teacher.left && !current.left) {
        current.left = true;
        db.users = db.users.filter(user => user.tid != current.id);
      }
    });
    mergeAudit();
  } else {
    const additions = [];
    const now = new Date();

    for (const lesson of clientDb.lessons.filter(
      lesson => lesson.isNew && lesson.tid == session.tid
    )) {
      const slot = db.slots.find(
        current => current.id == lesson.slot && current.tid == session.tid
      );
      if (!slot) return 'Lesson not scheduled for you';
      if (db.cancels.some(cancel => cancel.slot == lesson.slot && cancel.date == lesson.date)) {
        return 'This lesson was cancelled by the academy.';
      }
      if (paused(db.students.find(student => student.id == slot.sid), lesson.date)) {
        return 'This student is on a break for that date.';
      }
      if (
        ![...db.lessons, ...additions].some(
          current =>
            current.slot == lesson.slot &&
            current.date == lesson.date &&
            current.status != 'rejected'
        ) === false
      ) {
        return 'This lesson is already registered for that date.';
      }

      const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(lesson.date || '');
      if (!date || !(+lesson.dur >= 5 && +lesson.dur <= 300)) {
        return 'Invalid lesson data';
      }
      if (
        new Date(+date[1], +date[2] - 1, +date[3], 0, toMin(slot.start) + slot.dur) > now
      ) {
        return 'You can only register a lesson after it ends.';
      }

      additions.push({
        id: db.n.l++,
        tid: session.tid,
        sid: slot.sid,
        slot: slot.id,
        sub: slot.sub,
        date: lesson.date,
        dur: +lesson.dur,
        hw: String(lesson.hw || '').slice(0, 300),
        advice: String(lesson.advice || '').slice(0, 300),
        att: lesson.att == 'absent' ? 'absent' : 'present',
        rating:
          lesson.att == 'absent' ? 0 : Math.min(5, Math.max(1, +lesson.rating || 5)),
        status: 'approved',
        tr: (db.teachers.find(teacher => teacher.id == session.tid) || {}).rate || 0,
        sr: (db.students.find(student => student.id == slot.sid) || {}).rate || 0
      });
    }

    db.lessons.push(...additions);
  }

  if (session.role != 'teacher' && Array.isArray(clientDb.cancels)) {
    db.cancels = clientDb.cancels
      .filter(
        cancel =>
          cancel && Number.isFinite(+cancel.slot) && /^\d{4}-\d{2}-\d{2}$/.test(cancel.date)
      )
      .map(cancel => ({ slot: +cancel.slot, date: cancel.date, by: session.u }));
  }

  if (session.role == 'hr') {
    clientDb.lessons.forEach(lesson => {
      const current = db.lessons.find(existing => existing.id == lesson.id);
      if (current) current.sent = !!lesson.sent;
    });
  }

  db.students.forEach(student => {
    if (student.phone != null) {
      student.phone = String(student.phone).replace(/[^0-9]/g, '').slice(0, 15);
    }
  });

  if (session.role != 'teacher') {
    (clientDb.reminders || []).forEach(reminder => {
      const current = db.reminders.find(existing => existing.key == reminder.key);
      if (current && current.status == 'due' && reminder.status == 'sent') {
        current.status = 'sent';
      }
    });
  }

  if (session.role == 'admin' && clientDb.settings && typeof clientDb.settings == 'object') {
    db.settings = { pay: String(clientDb.settings.pay || '').slice(0, 300) };
  }

  for (const key in db.n) {
    db.n[key] = Math.max(db.n[key], (clientDb.n && clientDb.n[key]) || 0);
  }

  return null;
}

const dOK = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
const okPause = pause =>
  pause && dOK(pause.from)
    ? { from: pause.from, to: dOK(pause.to) ? pause.to : '' }
    : undefined;
const paused = (student, date) =>
  !!(
    student &&
    student.pause &&
    student.pause.from &&
    date >= student.pause.from &&
    (!student.pause.to || date <= student.pause.to)
  );
const cleanS = student => ({
  ...student,
  name: String(student.name || '').trim().slice(0, 100) || '?',
  payMethod: String(student.payMethod || '').slice(0, 200),
  pause: okPause(student.pause)
});

// ---- WhatsApp reminders (30 min before each lesson) ----
const WA_API = process.env.WA_API || 'https://graph.facebook.com/v20.0';
const NOW = () =>
  process.env.MIHRAB_TEST_NOW ? new Date(process.env.MIHRAB_TEST_NOW) : new Date();

const readWA = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, 'whatsapp.json'), 'utf8'));
  } catch (error) {
    return {};
  }
};

const auto = () => {
  const settings = readWA();
  return !!(settings.token && settings.phoneId);
};

const ymdS = date =>
  date.getFullYear() +
  '-' +
  String(date.getMonth() + 1).padStart(2, '0') +
  '-' +
  String(date.getDate()).padStart(2, '0');
const DNs = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const hm12 = minutes => {
  minutes %= 1440;
  const hours = Math.floor(minutes / 60);
  return (
    (hours % 12 || 12) +
    ':' +
    String(minutes % 60).padStart(2, '0') +
    ' ' +
    (hours < 12 ? 'AM' : 'PM')
  );
};

async function sendWA(settings, to, params) {
  const response = await fetch(WA_API + '/' + settings.phoneId + '/messages', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + settings.token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: settings.reminderTemplate || 'class_reminder',
        language: { code: settings.language || 'en' },
        components: [
          {
            type: 'body',
            parameters: params.map(param => ({ type: 'text', text: String(param) }))
          }
        ]
      }
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((result.error && result.error.message) || 'HTTP ' + response.status);
  }
  return result;
}

function tick() {
  const settings = readWA();
  const automatic = !!(settings.token && settings.phoneId);
  const minutesBefore = +settings.minutesBefore || 30;
  const now = NOW();
  let changed = false;

  for (let offset = -1; offset <= 1; offset++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const dateString = ymdS(date);

    db.slots
      .filter(
        slot => slot.day == DNs[date.getDay()] && (!slot.since || dateString >= slot.since)
      )
      .forEach(slot => {
        const start = new Date(
          date.getFullYear(),
          date.getMonth(),
          date.getDate(),
          0,
          toMin(slot.start)
        );
        const key = slot.id + '|' + dateString;

        if (
          now < new Date(start - minutesBefore * 6e4) ||
          now >= start ||
          db.reminders.some(reminder => reminder.key == key) ||
          db.cancels.some(cancel => cancel.slot == slot.id && cancel.date == dateString)
        ) {
          return;
        }

        const student = db.students.find(current => current.id == slot.sid);
        const teacher = db.teachers.find(current => current.id == slot.tid);
        if (
          !student ||
          student.left ||
          !teacher ||
          teacher.left ||
          paused(student, dateString)
        ) {
          return;
        }

        const time = hm12(toMin(slot.start));
        const reminder = {
          key,
          slot: slot.id,
          sid: slot.sid,
          date: dateString,
          student: student.name,
          sub: slot.sub,
          teacher: teacher.name,
          time,
          at: now.toISOString(),
          status: student.phone ? 'due' : 'nophone',
          text: `Assalamu alaikum! A friendly reminder from MIHRAB Educational Institute: ${student.name}'s ${slot.sub} lesson with ${teacher.name} starts today at ${time} (in about ${minutesBefore} minutes). Jazakum Allahu khairan.`
        };

        db.reminders.unshift(reminder);
        changed = true;

        if (automatic && student.phone) {
          sendWA(settings, student.phone, [student.name, slot.sub, teacher.name, time])
            .then(() => {
              reminder.status = 'sent';
            })
            .catch(error => {
              reminder.status = 'failed';
              reminder.error = String(error.message).slice(0, 200);
            })
            .finally(persist);
        }
      });
  }

  if (db.reminders.length > 300) db.reminders.length = 300;
  if (changed) persist();
}

setInterval(tick, +process.env.TICK_MS || 30000);
tick();

const sessions = new Map();
const send = (response, status, object) => {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(object));
};

http
  .createServer((request, response) => {
    if (
      request.method == 'GET' &&
      (request.url == '/' || request.url == '/index.html')
    ) {
      return fs.readFile(path.join(DIR, 'public', 'index.html'), (error, body) => {
        response.writeHead(error ? 500 : 200, {
          'Content-Type': 'text/html; charset=utf-8'
        });
        response.end(error ? 'Missing public/index.html' : body);
      });
    }

    if (!request.url.startsWith('/api/')) {
      return send(response, 404, { error: 'Not found' });
    }

    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 60e6) request.destroy();
    });

    request.on('end', () => {
      let data = {};
      try {
        data = body ? JSON.parse(body) : {};
      } catch (error) {
        return send(response, 400, { error: 'Bad JSON' });
      }

      if (request.url == '/api/login' && request.method == 'POST') {
        const user = db.users.find(current => current.u == data.u);
        if (!user || !ok(data.p, user.h)) {
          return setTimeout(() => send(response, 401, { error: 'Invalid' }), 600);
        }

        const token = crypto.randomBytes(24).toString('hex');
        const session = {
          u: user.u,
          role: user.role,
          tid: user.tid,
          exp: Date.now() + 12 * 36e5
        };
        sessions.set(token, session);
        return send(response, 200, {
          token,
          u: session.u,
          role: session.role,
          tid: session.tid,
          db: view(session)
        });
      }

      const session = sessions.get((request.headers.authorization || '').slice(7));
      if (
        !session ||
        session.exp < Date.now() ||
        !db.users.some(user => user.u == session.u)
      ) {
        return send(response, 401, { error: 'Session expired' });
      }

      if (request.url == '/api/db' && request.method == 'GET') {
        return send(response, 200, view(session));
      }

      if (request.url == '/api/db' && request.method == 'PUT') {
        const error = merge(
          session,
          data,
          request.headers['x-restore'] == '1' && session.role == 'admin'
        );
        if (error) return send(response, 400, { error });
        persist();
        return send(response, 200, view(session));
      }

      if (request.url == '/api/password' && request.method == 'POST') {
        const user = db.users.find(current => current.u == session.u);
        if (!ok(data.old, user.h) || String(data.new || '').length < 6) {
          return send(response, 400, { error: 'Invalid' });
        }
        user.h = hash(data.new);
        persist();
        return send(response, 200, { ok: 1 });
      }

      send(response, 404, { error: 'Not found' });
    });
  })
  .listen(PORT, '0.0.0.0', () => {
    console.log('\nMIHRAB is running.\n  On this PC:   http://localhost:' + PORT);
    Object.values(os.networkInterfaces())
      .flat()
      .filter(address => address.family == 'IPv4' && !address.internal)
      .forEach(address => console.log('  Other PCs:    http://' + address.address + ':' + PORT));
    console.log('\nKeep this window open. Press Ctrl+C to stop.\n');
  });
