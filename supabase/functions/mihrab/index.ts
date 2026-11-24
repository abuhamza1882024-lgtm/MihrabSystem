import { createClient } from 'npm:@supabase/supabase-js@2';
import bcrypt from 'npm:bcryptjs@2.4.3';

const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  secretKeys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-restore',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS'
};

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: cors });

const strip = (object: Record<string, unknown>, ...keys: string[]) => {
  const result = { ...object };
  keys.forEach(key => delete result[key]);
  return result;
};

const hashToken = async (token: string) => {
  const bytes = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
};

const loadState = async () => {
  const { data, error } = await supabase.rpc('load_mihrab_state');
  if (error) throw error;
  return data;
};

const databaseState = (state: any) => ({
  users: state.users.map((user: any) => ({
    username: String(user.u),
    password_hash: user.h,
    role: user.role,
    teacher_id: user.tid || null
  })),
  teachers: state.teachers.map((teacher: any) => ({
    id: teacher.id,
    name: teacher.name,
    rate: +teacher.rate || 0,
    photo: teacher.photo || '',
    edu: teacher.edu || '',
    pay_method: teacher.payMethod || '',
    left_academy: !!teacher.left
  })),
  students: state.students.map((student: any) => ({
    id: student.id,
    name: student.name,
    rate: +student.rate || 0,
    phone: student.phone || '',
    subs: student.subs || [],
    pay_method: student.payMethod || '',
    pause: student.pause || null,
    left_academy: !!student.left
  })),
  subjects: state.subjects,
  slots: state.slots.map((slot: any) => ({
    id: slot.id,
    teacher_id: slot.tid,
    student_id: slot.sid,
    day: slot.day,
    start_time: slot.start,
    duration: slot.dur,
    subject: slot.sub,
    since_date: slot.since || null
  })),
  lessons: state.lessons.map((lesson: any) => ({
    id: lesson.id,
    teacher_id: lesson.tid,
    student_id: lesson.sid,
    slot_id: lesson.slot,
    subject: lesson.sub,
    lesson_date: lesson.date,
    duration: lesson.dur,
    homework: lesson.hw || '',
    advice: lesson.advice || '',
    attendance: lesson.att || null,
    rating: lesson.rating ?? null,
    status: lesson.status,
    teacher_rate: +lesson.tr || 0,
    student_rate: +lesson.sr || 0,
    sent: !!lesson.sent
  })),
  pay: state.pay || {},
  audit: (state.audit || []).map((entry: any) => ({
    happened_at: String(entry.t),
    username: String(entry.by),
    message: String(entry.m)
  })),
  shared: state.shared || {},
  cancels: (state.cancels || []).map((cancel: any) => ({
    slot_id: cancel.slot,
    lesson_date: cancel.date,
    username: cancel.by
  })),
  reminders: (state.reminders || []).map((reminder: any) => ({
    key: reminder.key,
    slot_id: reminder.slot,
    student_id: reminder.sid,
    lesson_date: reminder.date,
    student_name: reminder.student,
    subject: reminder.sub,
    teacher_name: reminder.teacher,
    lesson_time: reminder.time,
    created_at: reminder.at,
    status: reminder.status,
    message: reminder.text,
    error: reminder.error || null
  })),
  settings: state.settings || { pay: '' },
  n: state.n
});

const saveState = async (state: any, version: number) => {
  const { data, error } = await supabase.rpc('save_mihrab_state', {
    state: databaseState(state),
    expected_version: version
  });
  if (error) throw error;
  return data;
};

const dateOk = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
const validPause = (pause: any) =>
  pause && dateOk(pause.from)
    ? { from: pause.from, to: dateOk(pause.to) ? pause.to : '' }
    : undefined;
const paused = (student: any, date: string) =>
  !!(
    student &&
    student.pause &&
    student.pause.from &&
    date >= student.pause.from &&
    (!student.pause.to || date <= student.pause.to)
  );
const cleanStudent = (student: any) => ({
  ...student,
  name: String(student.name || '').trim().slice(0, 100) || '?',
  payMethod: String(student.payMethod || '').slice(0, 200),
  pause: validPause(student.pause)
});

const toMinutes = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number);
  const total = hours * 60 + minutes;
  return total < 720 ? total + 1440 : total;
};

const automaticWhatsApp = () =>
  !!(Deno.env.get('WHATSAPP_TOKEN') && Deno.env.get('WHATSAPP_PHONE_ID'));

function view(state: any, session: any) {
  const base = { subjects: state.subjects, n: state.n };
  if (session.role == 'admin') {
    return {
      ...state,
      version: undefined,
      waAuto: automaticWhatsApp(),
      users: state.users.map((user: any) => strip(user, 'h'))
    };
  }
  if (session.role == 'hr') {
    return {
      ...base,
      teachers: state.teachers.map((teacher: any) => strip(teacher, 'rate')),
      students: state.students.map((student: any) => strip(student, 'rate')),
      slots: state.slots,
      lessons: state.lessons.map((lesson: any) => strip(lesson, 'tr', 'sr')),
      cancels: state.cancels,
      reminders: state.reminders.slice(0, 50),
      waAuto: automaticWhatsApp(),
      users: [],
      pay: {},
      audit: [],
      shared: {}
    };
  }
  const slots = state.slots.filter((slot: any) => slot.tid == session.tid);
  const lessons = state.lessons
    .filter((lesson: any) => lesson.tid == session.tid)
    .map((lesson: any) => strip(lesson, 'sr'));
  const studentIds = new Set([
    ...slots.map((slot: any) => slot.sid),
    ...lessons.map((lesson: any) => lesson.sid)
  ]);
  const sharedPattern = new RegExp('^t' + session.tid + '(\\d{4}-\\d{2})?$');
  return {
    ...base,
    teachers: state.teachers.filter((teacher: any) => teacher.id == session.tid),
    students: state.students
      .filter((student: any) => studentIds.has(student.id))
      .map((student: any) => strip(student, 'rate', 'phone')),
    slots,
    lessons,
    cancels: state.cancels.filter((cancel: any) =>
      slots.some((slot: any) => slot.id == cancel.slot)
    ),
    users: [],
    pay: {},
    audit: [],
    shared: Object.fromEntries(
      Object.entries(state.shared || {}).filter(([key]) => sharedPattern.test(key))
    )
  };
}

async function merge(state: any, session: any, clientState: any, restore: boolean) {
  if (
    !clientState ||
    ['teachers', 'students', 'slots', 'lessons'].some(
      key => !Array.isArray(clientState[key])
    )
  ) {
    return 'Invalid data';
  }

  const mergeAudit = () => {
    const seen = new Set(state.audit.map((entry: any) => entry.t + entry.by + entry.m));
    [...(clientState.audit || [])].reverse().forEach((entry: any) => {
      if (entry && !seen.has(entry.t + entry.by + entry.m)) {
        state.audit.unshift({
          t: String(entry.t),
          by: session.u,
          m: String(entry.m).slice(0, 300)
        });
      }
    });
    state.audit = state.audit.slice(0, 500);
  };

  if (session.role == 'admin') {
    const users = [];
    for (const user of clientState.users || []) {
      const current = state.users.find((existing: any) => existing.u == user.u);
      users.push({
        u: String(user.u),
        role: user.role,
        tid: user.tid,
        h: user.p
          ? await bcrypt.hash(user.p, 10)
          : current
            ? current.h
            : await bcrypt.hash('ChangeMe123', 10)
      });
    }
    if (
      !users.some(user => user.role == 'admin') ||
      users.some(user => !['admin', 'hr', 'teacher'].includes(user.role))
    ) {
      return 'At least one admin is required';
    }
    if (restore) {
      state.lessons = clientState.lessons;
    } else {
      const lessons = new Map(state.lessons.map((lesson: any) => [lesson.id, lesson]));
      clientState.lessons.forEach((lesson: any) => lessons.set(lesson.id, lesson));
      state.lessons = [...lessons.values()];
    }
    state.users = users;
    state.teachers = clientState.teachers.map((teacher: any) => ({
      ...teacher,
      photo: String(teacher.photo || '').slice(0, 500),
      edu: String(teacher.edu || '').slice(0, 200),
      payMethod: String(teacher.payMethod || '').slice(0, 200)
    }));
    state.students = clientState.students.map(cleanStudent);
    state.subjects = clientState.subjects;
    state.slots = clientState.slots;
    state.pay = clientState.pay || {};
    state.shared = clientState.shared || {};
    mergeAudit();
  } else if (session.role == 'hr') {
    state.slots = clientState.slots;
    state.students = clientState.students.map((student: any) => {
      const current = state.students.find((existing: any) => existing.id == student.id);
      return { ...cleanStudent(student), rate: current ? current.rate : 0 };
    });
    clientState.teachers.forEach((teacher: any) => {
      const current = state.teachers.find((existing: any) => existing.id == teacher.id);
      if (!current) return;
      if (String(teacher.name || '').trim()) {
        current.name = String(teacher.name).trim().slice(0, 100);
      }
      current.payMethod = String(teacher.payMethod || '').slice(0, 200);
      if (teacher.left && !current.left) {
        current.left = true;
        state.users = state.users.filter((user: any) => user.tid != current.id);
      }
    });
    mergeAudit();
  } else {
    const additions = [];
    const now = new Date();
    for (const lesson of clientState.lessons.filter(
      (lesson: any) => lesson.isNew && lesson.tid == session.tid
    )) {
      const slot = state.slots.find(
        (current: any) => current.id == lesson.slot && current.tid == session.tid
      );
      if (!slot) return 'Lesson not scheduled for you';
      if (
        state.cancels.some(
          (cancel: any) => cancel.slot == lesson.slot && cancel.date == lesson.date
        )
      ) {
        return 'This lesson was cancelled by the academy.';
      }
      if (paused(state.students.find((student: any) => student.id == slot.sid), lesson.date)) {
        return 'This student is on a break for that date.';
      }
      if (
        [...state.lessons, ...additions].some(
          (current: any) =>
            current.slot == lesson.slot &&
            current.date == lesson.date &&
            current.status != 'rejected'
        )
      ) {
        return 'This lesson is already registered for that date.';
      }
      const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(lesson.date || '');
      if (!date || !(+lesson.dur >= 5 && +lesson.dur <= 300)) {
        return 'Invalid lesson data';
      }
      if (
        new Date(+date[1], +date[2] - 1, +date[3], 0, toMinutes(slot.start) + slot.dur) >
        now
      ) {
        return 'You can only register a lesson after it ends.';
      }
      additions.push({
        id: state.n.l++,
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
        tr: (state.teachers.find((teacher: any) => teacher.id == session.tid) || {}).rate || 0,
        sr: (state.students.find((student: any) => student.id == slot.sid) || {}).rate || 0
      });
    }
    state.lessons.push(...additions);
  }

  if (session.role != 'teacher' && Array.isArray(clientState.cancels)) {
    state.cancels = clientState.cancels
      .filter(
        (cancel: any) =>
          cancel && Number.isFinite(+cancel.slot) && /^\d{4}-\d{2}-\d{2}$/.test(cancel.date)
      )
      .map((cancel: any) => ({ slot: +cancel.slot, date: cancel.date, by: session.u }));
  }
  if (session.role == 'hr') {
    clientState.lessons.forEach((lesson: any) => {
      const current = state.lessons.find((existing: any) => existing.id == lesson.id);
      if (current) current.sent = !!lesson.sent;
    });
  }
  state.students.forEach((student: any) => {
    if (student.phone != null) {
      student.phone = String(student.phone).replace(/[^0-9]/g, '').slice(0, 15);
    }
  });
  if (session.role != 'teacher') {
    (clientState.reminders || []).forEach((reminder: any) => {
      const current = state.reminders.find((existing: any) => existing.key == reminder.key);
      if (current && current.status == 'due' && reminder.status == 'sent') {
        current.status = 'sent';
      }
    });
  }
  if (
    session.role == 'admin' &&
    clientState.settings &&
    typeof clientState.settings == 'object'
  ) {
    state.settings = { pay: String(clientState.settings.pay || '').slice(0, 300) };
  }
  for (const key in state.n) {
    state.n[key] = Math.max(state.n[key], (clientState.n && clientState.n[key]) || 0);
  }
  return null;
}

const uploadImages = async (clientState: any, currentState: any) => {
  for (const teacher of clientState.teachers || []) {
    if (!String(teacher.photo || '').startsWith('data:image/')) continue;
    const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(teacher.photo);
    if (!match || teacher.photo.length > 200000) throw new Error('Invalid teacher image');
    const bytes = Uint8Array.from(atob(match[2]), character => character.charCodeAt(0));
    const extension = match[1] == 'image/jpeg' ? 'jpg' : match[1].split('/')[1];
    const path = `${teacher.id}.${extension}`;
    const { error } = await supabase.storage
      .from('teacher-images')
      .upload(path, bytes, { contentType: match[1], upsert: true });
    if (error) throw error;
    teacher.photo = supabase.storage.from('teacher-images').getPublicUrl(path).data.publicUrl;
  }
  for (const teacher of clientState.teachers || []) {
    const current = currentState.teachers.find((item: any) => item.id == teacher.id);
    if (current?.photo && !teacher.photo) {
      await supabase.storage
        .from('teacher-images')
        .remove([`${teacher.id}.jpg`, `${teacher.id}.png`, `${teacher.id}.webp`]);
    }
  }
};

const authenticate = async (request: Request) => {
  const token = (request.headers.get('authorization') || '').slice(7);
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const { data } = await supabase
    .from('sessions')
    .select('username, expires_at')
    .eq('token_hash', tokenHash)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (!data) return null;
  const state = await loadState();
  const user = state.users.find((item: any) => item.u == data.username);
  return user ? { u: user.u, role: user.role, tid: user.tid, state } : null;
};

const login = async (body: any) => {
  const state = await loadState();
  const user = state.users.find((item: any) => item.u == body.u);
  if (!user || !(await bcrypt.compare(String(body.p || ''), user.h))) {
    await new Promise(resolve => setTimeout(resolve, 600));
    return json({ error: 'Invalid' }, 401);
  }
  const token = Array.from(crypto.getRandomValues(new Uint8Array(24)), byte =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + 12 * 36e5).toISOString();
  const { error } = await supabase.from('sessions').insert({
    token_hash: tokenHash,
    username: user.u,
    expires_at: expiresAt
  });
  if (error) throw error;
  return json({
    token,
    u: user.u,
    role: user.role,
    tid: user.tid,
    db: view(state, user)
  });
};

const updateState = async (session: any, clientState: any, restore: boolean) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = await loadState();
    if (session.role == 'admin') await uploadImages(clientState, state);
    const error = await merge(state, session, clientState, restore);
    if (error) return json({ error }, 400);
    try {
      await saveState(state, state.version);
      return json(view(state, session));
    } catch (error) {
      if (!String(error).includes('state_conflict') || attempt == 2) throw error;
    }
  }
};

const changePassword = async (session: any, body: any) => {
  const state = await loadState();
  const user = state.users.find((item: any) => item.u == session.u);
  if (
    !user ||
    !(await bcrypt.compare(String(body.old || ''), user.h)) ||
    String(body.new || '').length < 6
  ) {
    return json({ error: 'Invalid' }, 400);
  }
  user.h = await bcrypt.hash(body.new, 10);
  await saveState(state, state.version);
  return json({ ok: 1 });
};

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dateString = (date: Date) =>
  date.getFullYear() +
  '-' +
  String(date.getMonth() + 1).padStart(2, '0') +
  '-' +
  String(date.getDate()).padStart(2, '0');
const time12 = (minutes: number) => {
  minutes %= 1440;
  const hours = Math.floor(minutes / 60);
  return `${hours % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
};

const sendWhatsApp = async (phone: string, params: string[]) => {
  const response = await fetch(
    `${Deno.env.get('WHATSAPP_API') || 'https://graph.facebook.com/v20.0'}/${Deno.env.get('WHATSAPP_PHONE_ID')}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('WHATSAPP_TOKEN')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
          name: Deno.env.get('WHATSAPP_TEMPLATE') || 'class_reminder',
          language: { code: Deno.env.get('WHATSAPP_LANGUAGE') || 'en' },
          components: [
            {
              type: 'body',
              parameters: params.map(text => ({ type: 'text', text }))
            }
          ]
        }
      })
    }
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message || `HTTP ${response.status}`);
};

const tick = async () => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = await loadState();
    const now = new Date();
    const minutesBefore = +(Deno.env.get('REMINDER_MINUTES') || 30);
    let changed = false;
    for (let offset = -1; offset <= 1; offset++) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
      const dateValue = dateString(date);
      for (const slot of state.slots.filter(
        (item: any) =>
          item.day == dayNames[date.getDay()] && (!item.since || dateValue >= item.since)
      )) {
        const start = new Date(
          date.getFullYear(),
          date.getMonth(),
          date.getDate(),
          0,
          toMinutes(slot.start)
        );
        const key = `${slot.id}|${dateValue}`;
        if (
          now < new Date(+start - minutesBefore * 6e4) ||
          now >= start ||
          state.reminders.some((item: any) => item.key == key) ||
          state.cancels.some(
            (item: any) => item.slot == slot.id && item.date == dateValue
          )
        ) {
          continue;
        }
        const student = state.students.find((item: any) => item.id == slot.sid);
        const teacher = state.teachers.find((item: any) => item.id == slot.tid);
        if (!student || student.left || !teacher || teacher.left || paused(student, dateValue)) {
          continue;
        }
        const time = time12(toMinutes(slot.start));
        const reminder = {
          key,
          slot: slot.id,
          sid: slot.sid,
          date: dateValue,
          student: student.name,
          sub: slot.sub,
          teacher: teacher.name,
          time,
          at: now.toISOString(),
          status: student.phone ? 'due' : 'nophone',
          text: `Assalamu alaikum! A friendly reminder from MIHRAB Educational Institute: ${student.name}'s ${slot.sub} lesson with ${teacher.name} starts today at ${time} (in about ${minutesBefore} minutes). Jazakum Allahu khairan.`
        };
        state.reminders.unshift(reminder);
        changed = true;
        if (automaticWhatsApp() && student.phone) {
          try {
            await sendWhatsApp(student.phone, [student.name, slot.sub, teacher.name, time]);
            reminder.status = 'sent';
          } catch (error) {
            reminder.status = 'failed';
            reminder.error = String(error instanceof Error ? error.message : error).slice(0, 200);
          }
        }
      }
    }
    if (state.reminders.length > 300) state.reminders.length = 300;
    if (!changed) return json({ ok: 1, reminders: 0 });
    try {
      await saveState(state, state.version);
      return json({ ok: 1, reminders: state.reminders.length });
    } catch (error) {
      if (!String(error).includes('state_conflict') || attempt == 2) throw error;
    }
  }
};

Deno.serve(async request => {
  if (request.method == 'OPTIONS') return new Response(null, { headers: cors });
  try {
    const path = new URL(request.url).pathname;
    const body = ['POST', 'PUT'].includes(request.method)
      ? await request.json().catch(() => null)
      : null;
    if (path.endsWith('/api/login') && request.method == 'POST') return await login(body || {});
    if (path.endsWith('/api/tick') && request.method == 'POST') {
      const key = request.headers.get('x-cron-key');
      if (!key || key != Deno.env.get('CRON_KEY')) return json({ error: 'Unauthorized' }, 401);
      return await tick();
    }
    const session = await authenticate(request);
    if (!session) return json({ error: 'Session expired' }, 401);
    if (path.endsWith('/api/db') && request.method == 'GET') {
      return json(view(session.state, session));
    }
    if (path.endsWith('/api/db') && request.method == 'PUT') {
      return await updateState(
        session,
        body,
        request.headers.get('x-restore') == '1' && session.role == 'admin'
      );
    }
    if (path.endsWith('/api/password') && request.method == 'POST') {
      return await changePassword(session, body || {});
    }
    return json({ error: 'Not found' }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: 'Server error' }, 500);
  }
});
