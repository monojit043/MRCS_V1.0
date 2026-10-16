-- Removes the Meetings module's tables from the MRCS database.
--
-- Meetings now lives in its own application and database (meetings_db).
-- Run this ONLY after confirming the Meetings app is working with the
-- migrated data — this permanently deletes the MRCS copy.
--
--   psql -U <user> -d mrcs_db -f backend/sql/drop-meetings-tables.sql

BEGIN;

DROP TABLE IF EXISTS
  meeting_reminder_log,
  meeting_audit_log,
  meeting_mail_log,
  meeting_action_items,
  meeting_points,
  meeting_minutes,
  meeting_agenda_items,
  meeting_participants,
  meeting_departments,
  meeting_series,
  meetings
CASCADE;

COMMIT;
