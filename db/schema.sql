-- Sandbox business data (what the agents work with) + the agents' own records (runs, steps, approvals, jobs).
-- Idempotent: safe to run again (npm run db:migrate).

-- ---------- Sandbox business systems ----------

-- Incoming sales mailbox (stands in for Gmail)
CREATE TABLE IF NOT EXISTS emails (
  id           BIGSERIAL PRIMARY KEY,
  from_name    TEXT NOT NULL,
  from_email   TEXT NOT NULL,
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  status       TEXT NOT NULL DEFAULT 'new'
               CHECK (status IN ('new', 'queued', 'processing', 'awaiting_approval', 'done', 'ignored', 'failed')),
  category     TEXT,          -- set by the triage agent: lead / support / spam / other
  sample_key   TEXT UNIQUE    -- id from sample-data/emails.json, so seeding is idempotent
);

-- Mini CRM (stands in for HubSpot)
CREATE TABLE IF NOT EXISTS contacts (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  company     TEXT,
  fleet_size  INT,
  stage       TEXT NOT NULL DEFAULT 'new'
              CHECK (stage IN ('new', 'qualified', 'meeting', 'customer', 'disqualified')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deals (
  id             BIGSERIAL PRIMARY KEY,
  contact_id     BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  plan           TEXT NOT NULL CHECK (plan IN ('Starter', 'Growth', 'Enterprise')),
  vehicles       INT,
  monthly_value  NUMERIC(10, 2),   -- NULL for Enterprise (custom pricing)
  stage          TEXT NOT NULL DEFAULT 'open' CHECK (stage IN ('open', 'won', 'lost')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activities (
  id          BIGSERIAL PRIMARY KEY,
  contact_id  BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('email_in', 'email_out', 'meeting', 'note')),
  summary     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sales calendar (stands in for Google Calendar)
CREATE TABLE IF NOT EXISTS calendar_events (
  id              BIGSERIAL PRIMARY KEY,
  title           TEXT NOT NULL,
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ NOT NULL,
  attendee_email  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

-- Sent mail (nothing really leaves the sandbox)
CREATE TABLE IF NOT EXISTS outbox (
  id        BIGSERIAL PRIMARY KEY,
  email_id  BIGINT REFERENCES emails(id) ON DELETE SET NULL,
  to_email  TEXT NOT NULL,
  subject   TEXT NOT NULL,
  body      TEXT NOT NULL,
  sent_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- The agents' own records ----------

-- One run = the agent team working on one email
CREATE TABLE IF NOT EXISTS agent_runs (
  id                 BIGSERIAL PRIMARY KEY,
  email_id           BIGINT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  status             TEXT NOT NULL DEFAULT 'running'
                     CHECK (status IN ('running', 'awaiting_approval', 'completed', 'failed')),
  model              TEXT,
  prompt_tokens      INT NOT NULL DEFAULT 0,
  completion_tokens  INT NOT NULL DEFAULT 0,
  result             JSONB,        -- triage + qualification summary for the UI
  error              TEXT,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at        TIMESTAMPTZ
);

-- Timeline: every LLM call, tool call, tool result and handoff (the "action log")
CREATE TABLE IF NOT EXISTS agent_steps (
  id          BIGSERIAL PRIMARY KEY,
  run_id      BIGINT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  agent       TEXT NOT NULL,     -- triage / qualify / draft / executor / human
  kind        TEXT NOT NULL CHECK (kind IN ('llm', 'tool_call', 'tool_result', 'output', 'handoff', 'error', 'human')),
  name        TEXT,              -- tool name, or a short label
  data        JSONB,
  ms          INT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_steps_run_idx ON agent_steps (run_id, id);

-- Actions the agents proposed. Nothing with side effects happens until a human approves it.
CREATE TABLE IF NOT EXISTS approvals (
  id           BIGSERIAL PRIMARY KEY,
  run_id       BIGINT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('send_reply', 'book_meeting', 'update_crm')),
  payload      JSONB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by   TEXT,
  decided_at   TIMESTAMPTZ,
  result       JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS approvals_pending_idx ON approvals (status) WHERE status = 'pending';

-- Job queue in Postgres: the worker takes jobs with FOR UPDATE SKIP LOCKED (no Redis needed)
CREATE TABLE IF NOT EXISTS jobs (
  id          BIGSERIAL PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('process_email')),
  payload     JSONB NOT NULL,
  status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts    INT NOT NULL DEFAULT 0,
  last_error  TEXT,
  run_after   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_queue_idx ON jobs (status, run_after) WHERE status = 'queued';
