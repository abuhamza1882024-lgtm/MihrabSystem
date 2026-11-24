create extension if not exists pgcrypto;

create table teachers (
  id bigint primary key,
  name text not null,
  hourly_rate numeric not null default 0,
  photo_url text not null default '',
  education text not null default '',
  payment_method text not null default '',
  left_academy boolean not null default false
);

create table students (
  id bigint primary key,
  name text not null,
  hourly_rate numeric not null default 0,
  phone text not null default '',
  subjects text[] not null default '{}',
  payment_method text not null default '',
  pause jsonb,
  left_academy boolean not null default false
);

create table users (
  username text primary key,
  password_hash text not null,
  role text not null check (role in ('admin', 'hr', 'teacher')),
  teacher_id bigint references teachers(id)
);

create table sessions (
  token_hash text primary key,
  username text not null,
  expires_at timestamptz not null
);

create index sessions_expires_at_idx on sessions(expires_at);

create table subjects (
  name text primary key,
  position integer not null
);

create table lesson_slots (
  id bigint primary key,
  teacher_id bigint not null references teachers(id),
  student_id bigint not null references students(id),
  day text not null,
  start_time text not null,
  duration integer not null,
  subject text not null,
  since_date text
);

create table lessons (
  id bigint primary key,
  teacher_id bigint not null references teachers(id),
  student_id bigint not null references students(id),
  slot_id bigint not null,
  subject text not null,
  lesson_date text not null,
  duration integer not null,
  homework text not null default '',
  advice text not null default '',
  attendance text,
  rating integer,
  status text not null,
  teacher_rate numeric not null default 0,
  student_rate numeric not null default 0,
  sent boolean not null default false
);

create table payments (
  key text primary key,
  paid boolean not null
);

create table audit_entries (
  position integer primary key,
  happened_at text not null,
  username text not null,
  message text not null
);

create table shared_reports (
  key text primary key,
  shared boolean not null
);

create table cancellations (
  slot_id bigint not null,
  lesson_date text not null,
  username text not null,
  primary key (slot_id, lesson_date)
);

create table reminders (
  key text primary key,
  slot_id bigint not null,
  student_id bigint not null,
  lesson_date text not null,
  student_name text not null,
  subject text not null,
  teacher_name text not null,
  lesson_time text not null,
  created_at text not null,
  status text not null,
  message text not null,
  error text
);

create table app_settings (
  id boolean primary key default true check (id),
  payment_instructions text not null default ''
);

create table counters (
  id boolean primary key default true check (id),
  teacher bigint not null default 1,
  student bigint not null default 1,
  slot bigint not null default 1,
  lesson bigint not null default 1,
  version bigint not null default 1
);

insert into subjects values
  ('Quran', 1),
  ('Arabic Language', 2),
  ('Islamic Studies', 3);

insert into app_settings default values;
insert into counters default values;

insert into users (username, password_hash, role) values
  ('admin', extensions.crypt('admin123', extensions.gen_salt('bf')), 'admin'),
  ('hr', extensions.crypt('hr123', extensions.gen_salt('bf')), 'hr');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('teacher-images', 'teacher-images', true, 150000, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create or replace function load_mihrab_state()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'users', coalesce((select jsonb_agg(jsonb_build_object('u', username, 'h', password_hash, 'role', role, 'tid', teacher_id) order by username) from users), '[]'::jsonb),
    'teachers', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', id, 'name', name, 'rate', hourly_rate, 'photo', photo_url, 'edu', education, 'payMethod', payment_method, 'left', nullif(left_academy, false))) order by id) from teachers), '[]'::jsonb),
    'students', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', id, 'name', name, 'rate', hourly_rate, 'phone', phone, 'subs', subjects, 'payMethod', payment_method, 'pause', pause, 'left', nullif(left_academy, false))) order by id) from students), '[]'::jsonb),
    'subjects', coalesce((select jsonb_agg(name order by position) from subjects), '[]'::jsonb),
    'slots', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', id, 'tid', teacher_id, 'sid', student_id, 'day', day, 'start', start_time, 'dur', duration, 'sub', subject, 'since', since_date)) order by id) from lesson_slots), '[]'::jsonb),
    'lessons', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', id, 'tid', teacher_id, 'sid', student_id, 'slot', slot_id, 'sub', subject, 'date', lesson_date, 'dur', duration, 'hw', homework, 'advice', advice, 'att', attendance, 'rating', rating, 'status', status, 'tr', teacher_rate, 'sr', student_rate, 'sent', nullif(sent, false))) order by id) from lessons), '[]'::jsonb),
    'pay', coalesce((select jsonb_object_agg(key, paid) from payments), '{}'::jsonb),
    'audit', coalesce((select jsonb_agg(jsonb_build_object('t', happened_at, 'by', username, 'm', message) order by position) from audit_entries), '[]'::jsonb),
    'shared', coalesce((select jsonb_object_agg(key, shared) from shared_reports), '{}'::jsonb),
    'cancels', coalesce((select jsonb_agg(jsonb_build_object('slot', slot_id, 'date', lesson_date, 'by', username)) from cancellations), '[]'::jsonb),
    'reminders', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('key', key, 'slot', slot_id, 'sid', student_id, 'date', lesson_date, 'student', student_name, 'sub', subject, 'teacher', teacher_name, 'time', lesson_time, 'at', created_at, 'status', status, 'text', message, 'error', error)) order by created_at desc) from reminders), '[]'::jsonb),
    'settings', jsonb_build_object('pay', (select payment_instructions from app_settings where id)),
    'n', jsonb_build_object('t', teacher, 's', student, 'sl', slot, 'l', lesson),
    'version', version
  )
  from counters
  where id;
$$;

create or replace function save_mihrab_state(state jsonb, expected_version bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  current_version bigint;
begin
  perform pg_advisory_xact_lock(68472621);
  select version into current_version from counters where id for update;
  if current_version <> expected_version then
    raise exception 'state_conflict';
  end if;

  delete from lesson_slots;
  delete from lessons;
  delete from users;
  delete from teachers;
  delete from students;
  delete from subjects;
  delete from payments;
  delete from audit_entries;
  delete from shared_reports;
  delete from cancellations;
  delete from reminders;

  insert into teachers
  select id, name, rate, coalesce(photo, ''), coalesce(edu, ''), coalesce(pay_method, ''), coalesce(left_academy, false)
  from jsonb_to_recordset(state->'teachers') as x(id bigint, name text, rate numeric, photo text, edu text, pay_method text, left_academy boolean);

  insert into students
  select id, name, rate, coalesce(phone, ''), coalesce(subs, '{}'), coalesce(pay_method, ''), pause, coalesce(left_academy, false)
  from jsonb_to_recordset(state->'students') as x(id bigint, name text, rate numeric, phone text, subs text[], pay_method text, pause jsonb, left_academy boolean);

  insert into users
  select username, password_hash, role, teacher_id
  from jsonb_to_recordset(state->'users') as x(username text, password_hash text, role text, teacher_id bigint);

  insert into subjects
  select value #>> '{}', ordinality::integer
  from jsonb_array_elements(state->'subjects') with ordinality as x(value, ordinality);

  insert into lesson_slots
  select id, teacher_id, student_id, day, start_time, duration, subject, since_date
  from jsonb_to_recordset(state->'slots') as x(id bigint, teacher_id bigint, student_id bigint, day text, start_time text, duration integer, subject text, since_date text);

  insert into lessons
  select id, teacher_id, student_id, slot_id, subject, lesson_date, duration, coalesce(homework, ''), coalesce(advice, ''), attendance, rating, status, teacher_rate, student_rate, coalesce(sent, false)
  from jsonb_to_recordset(state->'lessons') as x(id bigint, teacher_id bigint, student_id bigint, slot_id bigint, subject text, lesson_date text, duration integer, homework text, advice text, attendance text, rating integer, status text, teacher_rate numeric, student_rate numeric, sent boolean);

  insert into payments select key, value::text::boolean from jsonb_each(state->'pay');
  insert into shared_reports select key, value::text::boolean from jsonb_each(state->'shared');

  insert into audit_entries
  select ordinality::integer, entry->>'happened_at', entry->>'username', entry->>'message'
  from jsonb_array_elements(state->'audit') with ordinality as x(entry, ordinality);

  insert into cancellations
  select slot_id, lesson_date, username
  from jsonb_to_recordset(state->'cancels') as x(slot_id bigint, lesson_date text, username text);

  insert into reminders
  select key, slot_id, student_id, lesson_date, student_name, subject, teacher_name, lesson_time, created_at, status, message, error
  from jsonb_to_recordset(state->'reminders') as x(key text, slot_id bigint, student_id bigint, lesson_date text, student_name text, subject text, teacher_name text, lesson_time text, created_at text, status text, message text, error text);

  update app_settings set payment_instructions = coalesce(state->'settings'->>'pay', '') where id;
  update counters set
    teacher = (state->'n'->>'t')::bigint,
    student = (state->'n'->>'s')::bigint,
    slot = (state->'n'->>'sl')::bigint,
    lesson = (state->'n'->>'l')::bigint,
    version = version + 1
  where id
  returning version into current_version;

  return current_version;
end;
$$;

revoke all on function load_mihrab_state() from public, anon, authenticated;
revoke all on function save_mihrab_state(jsonb, bigint) from public, anon, authenticated;
grant execute on function load_mihrab_state() to service_role;
grant execute on function save_mihrab_state(jsonb, bigint) to service_role;

alter table teachers enable row level security;
alter table students enable row level security;
alter table users enable row level security;
alter table sessions enable row level security;
alter table subjects enable row level security;
alter table lesson_slots enable row level security;
alter table lessons enable row level security;
alter table payments enable row level security;
alter table audit_entries enable row level security;
alter table shared_reports enable row level security;
alter table cancellations enable row level security;
alter table reminders enable row level security;
alter table app_settings enable row level security;
alter table counters enable row level security;
