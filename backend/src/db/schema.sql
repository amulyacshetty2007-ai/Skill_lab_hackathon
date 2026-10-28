-- RailRush schema (PostgreSQL 14+)
-- Money is stored in paise (integer) so there is never a floating-point rounding bug.
-- The core double-booking guarantee is the PRIMARY KEY on seat_segments.

CREATE TABLE IF NOT EXISTS users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text        NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  email           text        NOT NULL,
  password_hash   text        NOT NULL,
  role            text        NOT NULL CHECK (role IN ('USER', 'ORGANISER')),
  token_version   integer     NOT NULL DEFAULT 0,      -- bump to revoke every issued JWT
  failed_logins   integer     NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (lower(email));

CREATE TABLE IF NOT EXISTS stations (
  id    serial PRIMARY KEY,
  code  text NOT NULL UNIQUE CHECK (code ~ '^[A-Z]{2,5}$'),
  name  text NOT NULL,
  city  text NOT NULL
);

-- Seat classes: rate is paise per km, cols is the layout (letters), aisle_after is the column index after which the aisle sits
CREATE TABLE IF NOT EXISTS seat_classes (
  code             text PRIMARY KEY,
  name             text    NOT NULL,
  rate_paise_km    integer NOT NULL CHECK (rate_paise_km > 0),
  reservation_fee_paise integer NOT NULL DEFAULT 3000,
  seat_rows        integer NOT NULL,
  cols             text    NOT NULL,
  aisle_after      integer NOT NULL
);

CREATE TABLE IF NOT EXISTS trains (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organiser_id  uuid        NOT NULL REFERENCES users(id),
  number        text        NOT NULL UNIQUE CHECK (number ~ '^[0-9A-Z]{3,8}$'),
  name          text        NOT NULL CHECK (char_length(name) BETWEEN 3 AND 60),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trains_organiser_idx ON trains (organiser_id);

-- Ordered route. seq 0..n-1; offsets are minutes after the origin departure.
CREATE TABLE IF NOT EXISTS train_stops (
  train_id          uuid    NOT NULL REFERENCES trains(id) ON DELETE CASCADE,
  seq               integer NOT NULL CHECK (seq >= 0),
  station_id        integer NOT NULL REFERENCES stations(id),
  arrive_offset_min integer NOT NULL CHECK (arrive_offset_min >= 0),
  depart_offset_min integer NOT NULL CHECK (depart_offset_min >= arrive_offset_min),
  distance_km       integer NOT NULL CHECK (distance_km >= 0),
  PRIMARY KEY (train_id, seq),
  UNIQUE (train_id, station_id)
);

CREATE TABLE IF NOT EXISTS coaches (
  train_id  uuid NOT NULL REFERENCES trains(id) ON DELETE CASCADE,
  code      text NOT NULL CHECK (code ~ '^[A-Z][0-9]{1,2}$'),
  class     text NOT NULL REFERENCES seat_classes(code),
  PRIMARY KEY (train_id, code)
);

CREATE TABLE IF NOT EXISTS seats (
  id        bigserial PRIMARY KEY,
  train_id  uuid    NOT NULL,
  coach     text    NOT NULL,
  seat_no   text    NOT NULL,          -- e.g. 3A
  row_no    integer NOT NULL,
  col_no    integer NOT NULL,
  class     text    NOT NULL REFERENCES seat_classes(code),
  FOREIGN KEY (train_id, coach) REFERENCES coaches(train_id, code) ON DELETE CASCADE,
  UNIQUE (train_id, coach, seat_no)
);
CREATE INDEX IF NOT EXISTS seats_train_idx ON seats (train_id);

CREATE TABLE IF NOT EXISTS train_runs (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  train_id  uuid        NOT NULL REFERENCES trains(id) ON DELETE CASCADE,
  start_at  timestamptz NOT NULL,       -- departure from the origin station
  status    text        NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'CANCELLED')),
  cancel_reason text,
  UNIQUE (train_id, start_at)
);
CREATE INDEX IF NOT EXISTS runs_start_idx ON train_runs (start_at);

CREATE TABLE IF NOT EXISTS bookings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pnr                 text        NOT NULL UNIQUE,
  user_id             uuid        NOT NULL REFERENCES users(id),
  run_id              uuid        NOT NULL REFERENCES train_runs(id),
  from_seq            integer     NOT NULL,
  to_seq              integer     NOT NULL,
  status              text        NOT NULL CHECK (status IN ('PENDING','CONFIRMED','CANCELLED','EXPIRED','FAILED')),
  seat_count          integer     NOT NULL CHECK (seat_count BETWEEN 1 AND 6),
  amount_paise        integer     NOT NULL CHECK (amount_paise > 0),
  hold_expires_at     timestamptz NOT NULL,
  payment_attempts    integer     NOT NULL DEFAULT 0,
  paid_amount_paise   integer,
  refund_amount_paise integer     NOT NULL DEFAULT 0,
  confirmed_at        timestamptz,
  cancelled_at        timestamptz,
  cancelled_by        text CHECK (cancelled_by IN ('USER','ORGANISER','SYSTEM')),
  cancel_reason       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (to_seq > from_seq),
  CHECK (refund_amount_paise >= 0 AND refund_amount_paise <= COALESCE(paid_amount_paise, 0)),
  CHECK (status <> 'CONFIRMED' OR paid_amount_paise = amount_paise)
);
CREATE INDEX IF NOT EXISTS bookings_user_idx    ON bookings (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bookings_run_idx     ON bookings (run_id, status);
CREATE INDEX IF NOT EXISTS bookings_pending_idx ON bookings (hold_expires_at) WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS booking_passengers (
  id          bigserial PRIMARY KEY,
  booking_id  uuid    NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  seat_id     bigint  NOT NULL REFERENCES seats(id),
  name        text    NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  age         integer NOT NULL CHECK (age BETWEEN 1 AND 120),
  gender      text    NOT NULL CHECK (gender IN ('M','F','O')),
  fare_paise  integer NOT NULL CHECK (fare_paise > 0),
  UNIQUE (booking_id, seat_id)
);

-- THE GUARANTEE.
-- One row per (run, seat, route-segment). Segment k is the hop between stop k and stop k+1.
-- A journey from stop a to stop b owns segments a .. b-1. The primary key makes it physically
-- impossible for two bookings to own the same seat on the same hop of the same run, no matter
-- how many requests race. Rows exist both for held (PENDING) and sold (CONFIRMED) seats and are
-- deleted when a hold expires or a booking is cancelled.
CREATE TABLE IF NOT EXISTS seat_segments (
  run_id      uuid    NOT NULL REFERENCES train_runs(id) ON DELETE CASCADE,
  seat_id     bigint  NOT NULL REFERENCES seats(id),
  seg_idx     integer NOT NULL CHECK (seg_idx >= 0),
  booking_id  uuid    NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  PRIMARY KEY (run_id, seat_id, seg_idx)
);
CREATE INDEX IF NOT EXISTS seat_segments_booking_idx ON seat_segments (booking_id);

CREATE TABLE IF NOT EXISTS payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       uuid        NOT NULL REFERENCES bookings(id),
  idempotency_key  text        NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 100),
  amount_paise     integer     NOT NULL,
  method           text        NOT NULL CHECK (method IN ('CARD','UPI')),
  instrument_hint  text,                       -- last 4 digits / masked VPA only. Never the full number.
  status           text        NOT NULL CHECK (status IN ('SUCCESS','FAILED')),
  failure_code     text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, idempotency_key)
);
-- At most one successful payment per booking, enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_success_uq ON payments (booking_id) WHERE status = 'SUCCESS';

CREATE TABLE IF NOT EXISTS audit_log (
  id         bigserial PRIMARY KEY,
  user_id    uuid,
  action     text        NOT NULL,
  entity     text,
  entity_id  text,
  meta       jsonb,
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_user_idx ON audit_log (user_id, created_at DESC);
