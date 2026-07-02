alter table sessions
  add column if not exists model text default null;
