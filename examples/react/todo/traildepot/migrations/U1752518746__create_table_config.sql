CREATE TABLE config (
  "id"          INTEGER PRIMARY KEY NOT NULL,
  "key"         TEXT NOT NULL,
  "value"       TEXT NOT NULL,
  "created_at"  TEXT NOT NULL DEFAULT(STRFTIME('%FT%TZ')),
  "updated_at"  TEXT NOT NULL DEFAULT(STRFTIME('%FT%TZ'))
);

CREATE UNIQUE INDEX _config_key_index ON config ("key");

CREATE TRIGGER _config__update_trigger AFTER UPDATE ON config FOR EACH ROW
  BEGIN
    UPDATE config SET updated_at = STRFTIME('%FT%TZ') WHERE id = OLD.id;
  END;

-- Insert default config for background color
INSERT INTO config ("key", "value") VALUES ('backgroundColor', '#f5f5f5');
