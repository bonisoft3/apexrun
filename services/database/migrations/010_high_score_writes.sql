-- The high-score table's writes (ir decision-leaderboard-writes). `public`
-- emits the reading arm alone, so the one writing arm is added here: a player,
-- guest or not, inserts a row of their own. Narrowing only, as the browser's
-- mirror requires: nothing here widens what `public` lets a reader see.
--
-- A score is a record, not a draft: no UPDATE or DELETE arm, and the privilege
-- itself revoked, so a permissive policy added later cannot reopen either.
--
-- The trigger keeps what a client must not choose. created_at is the server's
-- clock, not the client's. One row per player per 75 s: no run ends sooner (the
-- clock opens at 75 s and the shortest route takes longer at top speed;
-- tests/simulation.test.ts), so a second row inside that window is not a
-- second run. A redelivered POST is the same row, not a second one: the outbox
-- retries with the same client-minted id and the gateway adds
-- resolution=ignore-duplicates, but a BEFORE trigger runs before the conflict is
-- found, so a replayed id passes through untouched for ON CONFLICT DO NOTHING
-- to absorb. The advisory lock serializes one player's inserts, so two
-- concurrent ones cannot both find the window empty, and a replay racing its
-- original sees it committed rather than as a second run.
--
-- Idempotent via DROP ... IF EXISTS and CREATE OR REPLACE; initdb replays this
-- on a fresh volume.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

BEGIN;

DROP POLICY IF EXISTS high_score_player_insert ON high_score;
CREATE POLICY high_score_player_insert ON high_score FOR INSERT TO app_user
  WITH CHECK (player_id = auth_uid());

REVOKE UPDATE, DELETE ON high_score FROM app_user;

CREATE OR REPLACE FUNCTION high_score_admit() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('high_score:' || NEW.player_id::text, 0));
  IF EXISTS (SELECT 1 FROM high_score WHERE id = NEW.id) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM high_score
    WHERE player_id = NEW.player_id AND created_at > now() - interval '75 seconds'
  ) THEN
    RAISE EXCEPTION 'one high score per player per 75 seconds'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'high_score_cadence';
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS high_score_admit ON high_score;
CREATE TRIGGER high_score_admit
  BEFORE INSERT ON high_score
  FOR EACH ROW EXECUTE FUNCTION high_score_admit();

COMMIT;
