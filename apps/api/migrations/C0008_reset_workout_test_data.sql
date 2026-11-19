-- CF06: the exercise list moves from ten fixed exercises to the shared library (app.exercises).
-- Owner decision 2026-11-12 ("start fresh"): the test plans and templates that used the old ten
-- exercise ids are removed. Schema coach only. Deleting training plans cascades to their versions,
-- change log and calendar activities (C0004, C0006). Diet plans and clients are not touched.
delete from coach.training_plans;
delete from coach.workout_templates;
