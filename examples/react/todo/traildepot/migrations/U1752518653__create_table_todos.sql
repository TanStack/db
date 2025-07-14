CREATE TABLE todos (
  "id"          INTEGER PRIMARY KEY NOT NULL,
  "text"        TEXT NOT NULL,
  "completed"   INTEGER NOT NULL DEFAULT 0,
  "created_at"  TEXT NOT NULL DEFAULT(STRFTIME('%FT%TZ')),
  "updated_at"  TEXT NOT NULL DEFAULT(STRFTIME('%FT%TZ'))
) STRICT;

CREATE TRIGGER _todos__update_trigger AFTER UPDATE ON todos FOR EACH ROW
  BEGIN
    UPDATE todos SET updated_at = STRFTIME('%FT%TZ') WHERE id = OLD.id;
  END;
