-- The food tables as they are in the real shared database (app.foods with more sources and an optional
-- fibre value, app.food_portions, app.food_measures; checked read-only 2026-11-13), which the trainee repo
-- copy under test/fixtures/app-schema (0003) is older than. Test database only: never applied to Supabase.
alter table app.foods drop constraint foods_source_check;
alter table app.foods add constraint foods_source_check check (source in ('ifct2017', 'indb', 'brand_label', 'home', 'dish_estimate'));
alter table app.foods alter column fibre_g drop not null;
create table app.food_portions (
  source text not null,
  code text not null,
  seq integer not null check (seq >= 1 and seq <= 99),
  label text not null check (char_length(label) >= 1 and char_length(label) <= 80),
  grams numeric not null check (grams > 0 and grams <= 2000),
  primary key (source, code, seq),
  unique (source, code, label),
  foreign key (source, code) references app.foods (source, code) on delete cascade
);
create table app.food_measures (
  source text not null,
  code text not null,
  measure text not null check (measure in ('teaspoon', 'tablespoon', 'katori', 'glass', 'piece')),
  grams numeric not null check (grams > 0 and grams <= 1000),
  updated_at timestamptz not null default now(),
  primary key (source, code, measure),
  foreign key (source, code) references app.foods (source, code) on delete cascade
);
