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

  delete from lesson_slots where true;
  delete from lessons where true;
  delete from users where true;
  delete from teachers where true;
  delete from students where true;
  delete from subjects where true;
  delete from payments where true;
  delete from audit_entries where true;
  delete from shared_reports where true;
  delete from cancellations where true;
  delete from reminders where true;

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
